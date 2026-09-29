// Read a PDF twice: once as the text layer, once as pixels through Vision.
//
// The Ekpeye dictionary has two text layers in circulation and they fail in
// opposite directions. The archive.org text keeps the letters and mangles the
// special characters (ɗ→j, ŋ→q, ƙ→q, ị dropped or turned into j). pdf.js keeps
// the diacritics and drops whole runs drawn from a font with no ToUnicode map,
// so "àŋà" arrives as "à" and "akwa" as "a". Neither is enough on its own, so
// this writes the page images through Apple's OCR as a third reading, with the
// Igbo/Ekpeye vocabulary from both layers passed in as custom words.
//
//   swiftc -O -module-cache-path /tmp/mc ocr.swift -o ocr
//   ./ocr "Ekpeye dictionary.pdf" out-dir 3.0 [words.txt]
//
// Writes page-NNN.txt per page plus pages.json holding both the Vision text and
// the PDF text layer for that page, so the two can be compared line by line.

import Foundation
import PDFKit
import Vision

let args = CommandLine.arguments
guard args.count >= 4 else {
    FileHandle.standardError.write("usage: ocr <pdf> <out-dir> <scale> [words.txt]\n".data(using: .utf8)!)
    exit(2)
}
let pdfPath = args[1]
let outDir = args[2]
let scale = CGFloat(Double(args[3]) ?? 3.0)

var customWords: [String] = []
if args.count >= 5, let raw = try? String(contentsOfFile: args[4], encoding: .utf8) {
    customWords = raw.split(separator: "\n").map { String($0).trimmingCharacters(in: .whitespaces) }
        .filter { !$0.isEmpty }
}

try? FileManager.default.createDirectory(atPath: outDir, withIntermediateDirectories: true)

guard let document = PDFDocument(url: URL(fileURLWithPath: pdfPath)) else {
    FileHandle.standardError.write("cannot open \(pdfPath)\n".data(using: .utf8)!)
    exit(1)
}

/// One page's two readings.
struct PageReading: Codable {
    let page: Int
    let vision: String
    let textLayer: String
}

/// A recognised line with where it sits, so the columns can be put back together.
/// Vision returns blocks in reading order, and on a four-column table that order
/// walks the English column before the Ekpeye one — the boxes are what say which
/// gloss belongs to which headword.
struct Line: Codable {
    let x: Double
    let y: Double
    let w: Double
    let h: Double
    let text: String
}

var readings: [PageReading] = []
var everything: [String: [Line]] = [:]

for index in 0..<document.pageCount {
    guard let page = document.page(at: index) else { continue }
    let box = page.bounds(for: .mediaBox)

    // Render at `scale` times the page box. 3× on an A4 page is about 180 dpi,
    // which is past what Vision needs for 9pt print.
    let width = Int(box.width * scale)
    let height = Int(box.height * scale)
    guard width > 0, height > 0,
          let context = CGContext(
            data: nil,
            width: width,
            height: height,
            bitsPerComponent: 8,
            bytesPerRow: 0,
            space: CGColorSpaceCreateDeviceRGB(),
            bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue
          )
    else { continue }

    context.setFillColor(CGColor(red: 1, green: 1, blue: 1, alpha: 1))
    context.fill(CGRect(x: 0, y: 0, width: width, height: height))
    context.scaleBy(x: scale, y: scale)
    page.draw(with: .mediaBox, to: context)

    guard let image = context.makeImage() else { continue }

    let request = VNRecognizeTextRequest()
    request.recognitionLevel = .accurate
    // Off deliberately: the correction is an English language model, and every
    // word in the column being read is Ekpeye. It would rewrite them.
    request.usesLanguageCorrection = false
    request.recognitionLanguages = ["en-US"]
    if !customWords.isEmpty { request.customWords = customWords }

    let handler = VNImageRequestHandler(cgImage: image, options: [:])
    do {
        try handler.perform([request])
    } catch {
        FileHandle.standardError.write("vision failed on page \(index + 1): \(error)\n".data(using: .utf8)!)
    }

    var vision = ""
    var lines: [Line] = []
    if let observations = request.results {
        for observation in observations {
            if let candidate = observation.topCandidates(1).first {
                vision += candidate.string + "\n"
                let box = observation.boundingBox
                lines.append(
                    Line(
                        x: Double(box.origin.x),
                        y: Double(box.origin.y),
                        w: Double(box.size.width),
                        h: Double(box.size.height),
                        text: candidate.string
                    )
                )
            }
        }
    }
    everything[String(format: "%03d", index + 1)] = lines

    let text = page.string ?? ""
    readings.append(PageReading(page: index + 1, vision: vision, textLayer: text))

    let pageFile = String(format: "%@/page-%03d.txt", outDir, index + 1)
    try? vision.write(toFile: pageFile, atomically: true, encoding: .utf8)
    print("page \(index + 1)/\(document.pageCount): vision \(vision.count) chars, layer \(text.count) chars")
}

let encoder = JSONEncoder()
encoder.outputFormatting = [.prettyPrinted, .withoutEscapingSlashes]
if let data = try? encoder.encode(readings) {
    try? data.write(to: URL(fileURLWithPath: "\(outDir)/pages.json"))
}
if let data = try? encoder.encode(everything) {
    try? data.write(to: URL(fileURLWithPath: "\(outDir)/lines.json"))
}
print("wrote \(readings.count) pages to \(outDir)")
