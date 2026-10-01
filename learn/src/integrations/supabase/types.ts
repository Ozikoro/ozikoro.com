export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.18"
  }
  public: {
    Tables: {
      audit_log: {
        Row: {
          action: string
          actor_id: string | null
          created_at: string
          id: number
          new_status: string | null
          record_id: string | null
          table_name: string
        }
        Insert: {
          action: string
          actor_id?: string | null
          created_at?: string
          id?: never
          new_status?: string | null
          record_id?: string | null
          table_name: string
        }
        Update: {
          action?: string
          actor_id?: string | null
          created_at?: string
          id?: never
          new_status?: string | null
          record_id?: string | null
          table_name?: string
        }
        Relationships: []
      }
      course_lessons: {
        Row: {
          author_id: string | null
          cards: Json
          change_note: string | null
          created_at: string
          culture_note: string
          culture_source: string | null
          id: string
          objective: string
          position: number
          reviewer_id: string | null
          scene: string
          slug: string
          status: Database["public"]["Enums"]["content_status"]
          story: Json
          title: string
          unit_id: string
          updated_at: string
        }
        Insert: {
          author_id?: string | null
          cards?: Json
          change_note?: string | null
          created_at?: string
          culture_note?: string
          culture_source?: string | null
          id?: string
          objective?: string
          position?: number
          reviewer_id?: string | null
          scene?: string
          slug: string
          status?: Database["public"]["Enums"]["content_status"]
          story?: Json
          title: string
          unit_id: string
          updated_at?: string
        }
        Update: {
          author_id?: string | null
          cards?: Json
          change_note?: string | null
          created_at?: string
          culture_note?: string
          culture_source?: string | null
          id?: string
          objective?: string
          position?: number
          reviewer_id?: string | null
          scene?: string
          slug?: string
          status?: Database["public"]["Enums"]["content_status"]
          story?: Json
          title?: string
          unit_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "course_lessons_unit_id_fkey"
            columns: ["unit_id"]
            isOneToOne: false
            referencedRelation: "course_units"
            referencedColumns: ["id"]
          },
        ]
      }
      course_units: {
        Row: {
          author_id: string | null
          change_note: string | null
          created_at: string
          id: string
          level: number
          position: number
          reviewer_id: string | null
          status: Database["public"]["Enums"]["content_status"]
          title: string
          updated_at: string
        }
        Insert: {
          author_id?: string | null
          change_note?: string | null
          created_at?: string
          id?: string
          level?: number
          position?: number
          reviewer_id?: string | null
          status?: Database["public"]["Enums"]["content_status"]
          title: string
          updated_at?: string
        }
        Update: {
          author_id?: string | null
          change_note?: string | null
          created_at?: string
          id?: string
          level?: number
          position?: number
          reviewer_id?: string | null
          status?: Database["public"]["Enums"]["content_status"]
          title?: string
          updated_at?: string
        }
        Relationships: []
      }
      error_reports: {
        Row: {
          created_at: string
          id: string
          message: string
          resolved: boolean
          target_id: string | null
          target_type: string
          user_id: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          message: string
          resolved?: boolean
          target_id?: string | null
          target_type: string
          user_id?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          message?: string
          resolved?: boolean
          target_id?: string | null
          target_type?: string
          user_id?: string | null
        }
        Relationships: []
      }
      lesson_bookings: {
        Row: {
          created_at: string
          id: string
          learner_id: string
          minutes: number
          note: string
          paid: boolean
          payment_reference: string | null
          price_kobo: number
          starts_at: string
          status: Database["public"]["Enums"]["booking_status"]
          teacher_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          learner_id: string
          minutes?: number
          note?: string
          paid?: boolean
          payment_reference?: string | null
          price_kobo?: number
          starts_at: string
          status?: Database["public"]["Enums"]["booking_status"]
          teacher_id: string
        }
        Update: {
          created_at?: string
          id?: string
          learner_id?: string
          minutes?: number
          note?: string
          paid?: boolean
          payment_reference?: string | null
          price_kobo?: number
          starts_at?: string
          status?: Database["public"]["Enums"]["booking_status"]
          teacher_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "lesson_bookings_teacher_id_fkey"
            columns: ["teacher_id"]
            isOneToOne: false
            referencedRelation: "teacher_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      availability_exceptions: {
        Row: {
          id: string
          teacher_id: string
          on_date: string
          start_min: number | null
          end_min: number | null
          kind: string
          reason: string | null
          created_at: string
        }
        Insert: {
          id?: string
          teacher_id: string
          on_date: string
          start_min?: number | null
          end_min?: number | null
          kind?: string
          reason?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          teacher_id?: string
          on_date?: string
          start_min?: number | null
          end_min?: number | null
          kind?: string
          reason?: string | null
          created_at?: string
        }
        Relationships: []
      }
      conversations: {
        Row: {
          id: string
          participant_a: string
          participant_b: string
          booking_id: string | null
          last_message_at: string
          created_at: string
        }
        Insert: {
          id?: string
          participant_a: string
          participant_b: string
          booking_id?: string | null
          last_message_at?: string
          created_at?: string
        }
        Update: {
          id?: string
          participant_a?: string
          participant_b?: string
          booking_id?: string | null
          last_message_at?: string
          created_at?: string
        }
        Relationships: []
      }
      messages: {
        Row: {
          id: string
          conversation_id: string
          sender_id: string
          body: string | null
          attachment_url: string | null
          attachment_kind: string | null
          read_at: string | null
          created_at: string
        }
        Insert: {
          id?: string
          conversation_id: string
          sender_id: string
          body?: string | null
          attachment_url?: string | null
          attachment_kind?: string | null
          read_at?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          conversation_id?: string
          sender_id?: string
          body?: string | null
          attachment_url?: string | null
          attachment_kind?: string | null
          read_at?: string | null
          created_at?: string
        }
        Relationships: []
      }
      notifications: {
        Row: {
          id: string
          user_id: string
          kind: string
          title: string
          body: string | null
          link: string | null
          emailed_at: string | null
          read_at: string | null
          created_at: string
        }
        Insert: {
          id?: string
          user_id: string
          kind: string
          title: string
          body?: string | null
          link?: string | null
          emailed_at?: string | null
          read_at?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          user_id?: string
          kind?: string
          title?: string
          body?: string | null
          link?: string | null
          emailed_at?: string | null
          read_at?: string | null
          created_at?: string
        }
        Relationships: []
      }
      payments: {
        Row: {
          id: string
          booking_id: string | null
          payer_id: string
          amount_kobo: number
          currency: string
          provider: string
          provider_ref: string | null
          status: string
          provider_meta: Json
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          booking_id?: string | null
          payer_id: string
          amount_kobo: number
          currency?: string
          provider?: string
          provider_ref?: string | null
          status?: string
          provider_meta?: Json
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          booking_id?: string | null
          payer_id?: string
          amount_kobo?: number
          currency?: string
          provider?: string
          provider_ref?: string | null
          status?: string
          provider_meta?: Json
          created_at?: string
          updated_at?: string
        }
        Relationships: []
      }
      review_schedule: {
        Row: {
          id: string
          user_id: string
          lexeme_id: string
          ease: number
          interval_days: number
          streak: number
          reviews: number
          lapses: number
          due_at: string
          last_reviewed_at: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          user_id: string
          lexeme_id: string
          ease?: number
          interval_days?: number
          streak?: number
          reviews?: number
          lapses?: number
          due_at?: string
          last_reviewed_at?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          user_id?: string
          lexeme_id?: string
          ease?: number
          interval_days?: number
          streak?: number
          reviews?: number
          lapses?: number
          due_at?: string
          last_reviewed_at?: string | null
          created_at?: string
          updated_at?: string
        }
        Relationships: []
      }
      teacher_availability: {
        Row: {
          id: string
          teacher_id: string
          dow: number
          start_min: number
          end_min: number
          tz: string
          minutes: number
          created_at: string
        }
        Insert: {
          id?: string
          teacher_id: string
          dow: number
          start_min: number
          end_min: number
          tz?: string
          minutes?: number
          created_at?: string
        }
        Update: {
          id?: string
          teacher_id?: string
          dow?: number
          start_min?: number
          end_min?: number
          tz?: string
          minutes?: number
          created_at?: string
        }
        Relationships: []
      }
      teacher_wallets: {
        Row: {
          teacher_id: string
          balance_kobo: number
          pending_kobo: number
          currency: string
          payout_bank: string | null
          payout_account: string | null
          updated_at: string
        }
        Insert: {
          teacher_id: string
          balance_kobo?: number
          pending_kobo?: number
          currency?: string
          payout_bank?: string | null
          payout_account?: string | null
          updated_at?: string
        }
        Update: {
          teacher_id?: string
          balance_kobo?: number
          pending_kobo?: number
          currency?: string
          payout_bank?: string | null
          payout_account?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      transactions: {
        Row: {
          id: string
          payment_id: string | null
          teacher_id: string | null
          amount_kobo: number
          kind: string
          description: string | null
          created_at: string
        }
        Insert: {
          id?: string
          payment_id?: string | null
          teacher_id?: string | null
          amount_kobo: number
          kind: string
          description?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          payment_id?: string | null
          teacher_id?: string | null
          amount_kobo?: number
          kind?: string
          description?: string | null
          created_at?: string
        }
        Relationships: []
      }
      withdrawals: {
        Row: {
          id: string
          teacher_id: string
          amount_kobo: number
          status: string
          reference: string | null
          note: string | null
          decided_by: string | null
          decided_at: string | null
          created_at: string
        }
        Insert: {
          id?: string
          teacher_id: string
          amount_kobo: number
          status?: string
          reference?: string | null
          note?: string | null
          decided_by?: string | null
          decided_at?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          teacher_id?: string
          amount_kobo?: number
          status?: string
          reference?: string | null
          note?: string | null
          decided_by?: string | null
          decided_at?: string | null
          created_at?: string
        }
        Relationships: []
      }
      lesson_progress: {
        Row: {
          completed_at: string | null
          lesson_key: string
          state: Json
          updated_at: string
          user_id: string
        }
        Insert: {
          completed_at?: string | null
          lesson_key: string
          state?: Json
          updated_at?: string
          user_id: string
        }
        Update: {
          completed_at?: string | null
          lesson_key?: string
          state?: Json
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      lexeme_examples: {
        Row: {
          id: string
          lexeme_id: string
          position: number
          text_ig: string
          text_en: string | null
          audio_url: string | null
          status: Database["public"]["Enums"]["content_status"]
          source: string | null
          created_at: string
        }
        Insert: {
          id?: string
          lexeme_id: string
          position?: number
          text_ig: string
          text_en?: string | null
          audio_url?: string | null
          status?: Database["public"]["Enums"]["content_status"]
          source?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          lexeme_id?: string
          position?: number
          text_ig?: string
          text_en?: string | null
          audio_url?: string | null
          status?: Database["public"]["Enums"]["content_status"]
          source?: string | null
          created_at?: string
        }
        Relationships: []
      }
      lexemes: {
        Row: {
          ai_generated: boolean
          audio_url: string | null
          author_id: string | null
          change_note: string | null
          created_at: string
          dialect: string | null
          example_en: string | null
          example_ig: string | null
          headword: string
          id: string
          meaning: string
          part_of_speech: string | null
          reviewer_id: string | null
          search_key: string
          source: string | null
          status: Database["public"]["Enums"]["content_status"]
          tone_marked: string | null
          updated_at: string
          version: number
        }
        Insert: {
          ai_generated?: boolean
          audio_url?: string | null
          author_id?: string | null
          change_note?: string | null
          created_at?: string
          dialect?: string | null
          example_en?: string | null
          example_ig?: string | null
          headword: string
          id?: string
          meaning: string
          part_of_speech?: string | null
          reviewer_id?: string | null
          search_key?: string
          source?: string | null
          status?: Database["public"]["Enums"]["content_status"]
          tone_marked?: string | null
          updated_at?: string
          version?: number
        }
        Update: {
          ai_generated?: boolean
          audio_url?: string | null
          author_id?: string | null
          change_note?: string | null
          created_at?: string
          dialect?: string | null
          example_en?: string | null
          example_ig?: string | null
          headword?: string
          id?: string
          meaning?: string
          part_of_speech?: string | null
          reviewer_id?: string | null
          search_key?: string
          source?: string | null
          status?: Database["public"]["Enums"]["content_status"]
          tone_marked?: string | null
          updated_at?: string
          version?: number
        }
        Relationships: []
      }
      profiles: {
        Row: {
          created_at: string
          daily_goal_minutes: number
          display_name: string | null
          id: string
          is_adult: boolean
          learning_reason: string | null
          native_language: string | null
          onboarded: boolean
          settings: Json
          starting_level: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          daily_goal_minutes?: number
          display_name?: string | null
          id: string
          is_adult?: boolean
          learning_reason?: string | null
          native_language?: string | null
          onboarded?: boolean
          settings?: Json
          starting_level?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          daily_goal_minutes?: number
          display_name?: string | null
          id?: string
          is_adult?: boolean
          learning_reason?: string | null
          native_language?: string | null
          onboarded?: boolean
          settings?: Json
          starting_level?: string
          updated_at?: string
        }
        Relationships: []
      }
      school_hire_requests: {
        Row: {
          contact_email: string
          created_at: string
          id: string
          requester_id: string
          role_details: string
          school_name: string
          status: string
          teacher_id: string
        }
        Insert: {
          contact_email: string
          created_at?: string
          id?: string
          requester_id: string
          role_details?: string
          school_name: string
          status?: string
          teacher_id: string
        }
        Update: {
          contact_email?: string
          created_at?: string
          id?: string
          requester_id?: string
          role_details?: string
          school_name?: string
          status?: string
          teacher_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "school_hire_requests_teacher_id_fkey"
            columns: ["teacher_id"]
            isOneToOne: false
            referencedRelation: "teacher_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      teacher_profiles: {
        Row: {
          bio: string
          country: string
          created_at: string
          currency: string
          dialects: string[]
          display_name: string
          headline: string
          hourly_rate_kobo: number
          id: string
          open_to_schools: boolean
          photo_url: string | null
          qualifications: string
          specialties: string[]
          status: Database["public"]["Enums"]["teacher_status"]
          updated_at: string
          user_id: string
          video_url: string | null
          years_experience: number
        }
        Insert: {
          bio?: string
          country?: string
          created_at?: string
          currency?: string
          dialects?: string[]
          display_name: string
          headline?: string
          hourly_rate_kobo?: number
          id?: string
          open_to_schools?: boolean
          photo_url?: string | null
          qualifications?: string
          specialties?: string[]
          status?: Database["public"]["Enums"]["teacher_status"]
          updated_at?: string
          user_id: string
          video_url?: string | null
          years_experience?: number
        }
        Update: {
          bio?: string
          country?: string
          created_at?: string
          currency?: string
          dialects?: string[]
          display_name?: string
          headline?: string
          hourly_rate_kobo?: number
          id?: string
          open_to_schools?: boolean
          photo_url?: string | null
          qualifications?: string
          specialties?: string[]
          status?: Database["public"]["Enums"]["teacher_status"]
          updated_at?: string
          user_id?: string
          video_url?: string | null
          years_experience?: number
        }
        Relationships: []
      }
      teacher_reviews: {
        Row: {
          booking_id: string
          comment: string
          created_at: string
          id: string
          rating: number
          reviewer_id: string
          teacher_id: string
        }
        Insert: {
          booking_id: string
          comment?: string
          created_at?: string
          id?: string
          rating: number
          reviewer_id: string
          teacher_id: string
        }
        Update: {
          booking_id?: string
          comment?: string
          created_at?: string
          id?: string
          rating?: number
          reviewer_id?: string
          teacher_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "teacher_reviews_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: true
            referencedRelation: "lesson_bookings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "teacher_reviews_teacher_id_fkey"
            columns: ["teacher_id"]
            isOneToOne: false
            referencedRelation: "teacher_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      user_roles: {
        Row: {
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      teacher_ratings: {
        Row: {
          avg_rating: number | null
          review_count: number | null
          teacher_id: string | null
        }
        Relationships: [
          {
            foreignKeyName: "teacher_reviews_teacher_id_fkey"
            columns: ["teacher_id"]
            isOneToOne: false
            referencedRelation: "teacher_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Functions: {
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      is_staff: { Args: { _user_id: string }; Returns: boolean }
    }
    Enums: {
      app_role: "admin" | "linguist" | "editor"
      booking_status: "requested" | "confirmed" | "completed" | "cancelled"
      content_status: "draft" | "in_review" | "published" | "rejected"
      teacher_status: "pending" | "approved" | "suspended"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      app_role: ["admin", "linguist", "editor"],
      booking_status: ["requested", "confirmed", "completed", "cancelled"],
      content_status: ["draft", "in_review", "published", "rejected"],
      teacher_status: ["pending", "approved", "suspended"],
    },
  },
} as const
