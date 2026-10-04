/**
 * The registry: two engines, one lookup, and the reason the choice is a parameter.
 *
 * *"having both is good"* is the owner's decision. The way an accepted decision survives contact with the
 * code is that neither engine is privileged: `engineFor(request.engine)` returns the engine the request
 * NAMED, and there is no chain to fall through.
 *
 * **There is deliberately no `defaultEngine()`.** A default would be reached by any caller that forgot the
 * parameter, and the whole value of `engine` is that the archive records which model spoke. A default
 * makes the most important field in the record optional in practice. So the engines are named or the
 * request fails.
 */

import { MediaError, isEngineName, type EngineName } from '../errors.ts';
import type { EngineCapabilities, NarrationEngine } from '../types.ts';
import { ElevenLabsEngine } from './elevenlabs.ts';
import { LocalEngine } from './local.ts';

export type EngineSet = {
  local: LocalEngine;
  elevenlabs: ElevenLabsEngine;
};

/**
 * Build both engines.
 *
 * The local engine is constructed lazily-but-eagerly: the object exists immediately so `/health` can
 * report what is installed, but **the 1.35 GB checkpoint is not read until `preload` says so.** A service
 * that spends half a minute loading a model before it can answer `/health` cannot be asked why it is not
 * answering.
 */
export function createEngines(options: { preload?: boolean } = {}): EngineSet {
  return {
    local: new LocalEngine({ preload: options.preload ?? false }),
    elevenlabs: new ElevenLabsEngine(),
  };
}

export function engineFor(engines: EngineSet, name: unknown): NarrationEngine {
  if (!isEngineName(name)) {
    throw new MediaError({
      code: 'bad_request',
      status: 400,
      message:
        `unknown engine ${JSON.stringify(name)}. This service has exactly two, and the choice is not ` +
        `optional: \`local\` (self-hosted, free, slower, lower quality) or \`elevenlabs\` (hosted, costs ` +
        `credits, best quality). There is no default, because the engine that ran is written to the ` +
        `episode record.`,
      details: { known: ['local', 'elevenlabs'] },
    });
  }
  return name === 'local' ? engines.local : engines.elevenlabs;
}

export function capabilitiesOf(engines: EngineSet): EngineCapabilities[] {
  return [engines.local.capabilities(), engines.elevenlabs.capabilities()];
}

export { ElevenLabsEngine, LocalEngine };
export type { EngineName, NarrationEngine };
