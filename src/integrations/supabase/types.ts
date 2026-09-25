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
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      announcement_reads: {
        Row: {
          announcement_id: string
          id: string
          read_at: string
          user_id: string
        }
        Insert: {
          announcement_id: string
          id?: string
          read_at?: string
          user_id: string
        }
        Update: {
          announcement_id?: string
          id?: string
          read_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "announcement_reads_announcement_id_fkey"
            columns: ["announcement_id"]
            isOneToOne: false
            referencedRelation: "announcements"
            referencedColumns: ["id"]
          },
        ]
      }
      announcements: {
        Row: {
          body: string
          created_at: string
          created_by: string | null
          icon: string
          id: string
          image_url: string | null
          image_url2: string | null
          published_at: string
          push_sent_at: string | null
          target: string
          tenant_id: string | null
          title: string
        }
        Insert: {
          body: string
          created_at?: string
          created_by?: string | null
          icon?: string
          id?: string
          image_url?: string | null
          image_url2?: string | null
          published_at?: string
          push_sent_at?: string | null
          target?: string
          tenant_id?: string | null
          title: string
        }
        Update: {
          body?: string
          created_at?: string
          created_by?: string | null
          icon?: string
          id?: string
          image_url?: string | null
          image_url2?: string | null
          published_at?: string
          push_sent_at?: string | null
          target?: string
          tenant_id?: string | null
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "announcements_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      app_releases: {
        Row: {
          enabled: boolean
          latest_version: string | null
          note: string | null
          platform: string
          released_at: string | null
          updated_at: string
        }
        Insert: {
          enabled?: boolean
          latest_version?: string | null
          note?: string | null
          platform: string
          released_at?: string | null
          updated_at?: string
        }
        Update: {
          enabled?: boolean
          latest_version?: string | null
          note?: string | null
          platform?: string
          released_at?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      blocked_slots: {
        Row: {
          blocked_date: string
          created_at: string
          created_by: string
          end_blocked_date: string
          id: string
          reason: string | null
          recurrence_group: string | null
          source: string | null
          tenant_id: string | null
        }
        Insert: {
          blocked_date: string
          created_at?: string
          created_by: string
          end_blocked_date: string
          id?: string
          reason?: string | null
          recurrence_group?: string | null
          source?: string | null
          tenant_id?: string | null
        }
        Update: {
          blocked_date?: string
          created_at?: string
          created_by?: string
          end_blocked_date?: string
          id?: string
          reason?: string | null
          recurrence_group?: string | null
          source?: string | null
          tenant_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "blocked_slots_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      booking_blocked_windows: {
        Row: {
          created_at: string
          enabled: boolean
          end_time: string
          id: string
          start_time: string
          tenant_id: string
          updated_at: string
          weekdays: number[]
        }
        Insert: {
          created_at?: string
          enabled?: boolean
          end_time?: string
          id?: string
          start_time?: string
          tenant_id: string
          updated_at?: string
          weekdays: number[]
        }
        Update: {
          created_at?: string
          enabled?: boolean
          end_time?: string
          id?: string
          start_time?: string
          tenant_id?: string
          updated_at?: string
          weekdays?: number[]
        }
        Relationships: [
          {
            foreignKeyName: "booking_blocked_windows_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      booking_capacity_windows: {
        Row: {
          capacity: number
          created_at: string
          enabled: boolean
          end_time: string
          id: string
          start_time: string
          tenant_id: string
          updated_at: string
          weekdays: number[]
        }
        Insert: {
          capacity?: number
          created_at?: string
          enabled?: boolean
          end_time?: string
          id?: string
          start_time?: string
          tenant_id: string
          updated_at?: string
          weekdays: number[]
        }
        Update: {
          capacity?: number
          created_at?: string
          enabled?: boolean
          end_time?: string
          id?: string
          start_time?: string
          tenant_id?: string
          updated_at?: string
          weekdays?: number[]
        }
        Relationships: [
          {
            foreignKeyName: "booking_capacity_windows_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      booking_closed_days: {
        Row: {
          closed_date: string
          created_at: string
          created_by: string
          id: string
          reason: string | null
          tenant_id: string
        }
        Insert: {
          closed_date: string
          created_at?: string
          created_by: string
          id?: string
          reason?: string | null
          tenant_id: string
        }
        Update: {
          closed_date?: string
          created_at?: string
          created_by?: string
          id?: string
          reason?: string | null
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "booking_closed_days_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      booking_frequency_limits: {
        Row: {
          created_at: string
          enabled: boolean
          end_time: string
          exempt: boolean
          id: string
          max_bookings: number
          period: string
          start_time: string
          tenant_id: string
          updated_at: string
          user_id: string | null
          weekdays: number[]
        }
        Insert: {
          created_at?: string
          enabled?: boolean
          end_time?: string
          exempt?: boolean
          id?: string
          max_bookings?: number
          period?: string
          start_time?: string
          tenant_id: string
          updated_at?: string
          user_id?: string | null
          weekdays: number[]
        }
        Update: {
          created_at?: string
          enabled?: boolean
          end_time?: string
          exempt?: boolean
          id?: string
          max_bookings?: number
          period?: string
          start_time?: string
          tenant_id?: string
          updated_at?: string
          user_id?: string | null
          weekdays?: number[]
        }
        Relationships: [
          {
            foreignKeyName: "booking_frequency_limits_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      booking_notify_log: {
        Row: {
          actor_user_id: string | null
          booking_date: string
          booking_id: string
          booking_type: string | null
          created_at: string
          dispatched_at: string | null
          event: string
          http_request_id: number | null
          id: string
          last_error: string | null
          skip_reason: string | null
          tenant_id: string | null
          user_id: string
        }
        Insert: {
          actor_user_id?: string | null
          booking_date: string
          booking_id: string
          booking_type?: string | null
          created_at?: string
          dispatched_at?: string | null
          event: string
          http_request_id?: number | null
          id?: string
          last_error?: string | null
          skip_reason?: string | null
          tenant_id?: string | null
          user_id: string
        }
        Update: {
          actor_user_id?: string | null
          booking_date?: string
          booking_id?: string
          booking_type?: string | null
          created_at?: string
          dispatched_at?: string | null
          event?: string
          http_request_id?: number | null
          id?: string
          last_error?: string | null
          skip_reason?: string | null
          tenant_id?: string | null
          user_id?: string
        }
        Relationships: []
      }
      booking_options: {
        Row: {
          created_at: string
          description: string | null
          duration_minutes: number
          enabled: boolean
          id: string
          name: string
          price_yen: number
          sort_order: number
          tenant_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          duration_minutes?: number
          enabled?: boolean
          id?: string
          name: string
          price_yen?: number
          sort_order?: number
          tenant_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          description?: string | null
          duration_minutes?: number
          enabled?: boolean
          id?: string
          name?: string
          price_yen?: number
          sort_order?: number
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "booking_options_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      booking_questions: {
        Row: {
          ask_on_member: boolean
          ask_on_trial: boolean
          created_at: string
          help_text: string | null
          id: string
          input_type: string
          is_active: boolean
          label: string
          options: Json | null
          required: boolean
          sort_order: number
          tenant_id: string
          updated_at: string
        }
        Insert: {
          ask_on_member?: boolean
          ask_on_trial?: boolean
          created_at?: string
          help_text?: string | null
          id?: string
          input_type?: string
          is_active?: boolean
          label: string
          options?: Json | null
          required?: boolean
          sort_order?: number
          tenant_id: string
          updated_at?: string
        }
        Update: {
          ask_on_member?: boolean
          ask_on_trial?: boolean
          created_at?: string
          help_text?: string | null
          id?: string
          input_type?: string
          is_active?: boolean
          label?: string
          options?: Json | null
          required?: boolean
          sort_order?: number
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "booking_questions_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      booking_uncapped_days: {
        Row: {
          created_at: string
          created_by: string
          id: string
          reason: string | null
          tenant_id: string
          uncapped_date: string
        }
        Insert: {
          created_at?: string
          created_by: string
          id?: string
          reason?: string | null
          tenant_id: string
          uncapped_date: string
        }
        Update: {
          created_at?: string
          created_by?: string
          id?: string
          reason?: string | null
          tenant_id?: string
          uncapped_date?: string
        }
        Relationships: [
          {
            foreignKeyName: "booking_uncapped_days_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      booking_waitlist: {
        Row: {
          booking_date: string
          created_at: string
          id: string
          start_time: string
          tenant_id: string
          user_id: string
        }
        Insert: {
          booking_date: string
          created_at?: string
          id?: string
          start_time: string
          tenant_id: string
          user_id: string
        }
        Update: {
          booking_date?: string
          created_at?: string
          id?: string
          start_time?: string
          tenant_id?: string
          user_id?: string
        }
        Relationships: []
      }
      bookings: {
        Row: {
          booking_date: string
          booking_options: Json | null
          booking_type: string
          created_at: string
          created_via: string | null
          custom_answers: Json | null
          google_event_id: string | null
          id: string
          option_minutes: number
          source: string | null
          staff_user_id: string | null
          status: string
          tenant_id: string | null
          trainer_note: string | null
          user_id: string
        }
        Insert: {
          booking_date: string
          booking_options?: Json | null
          booking_type?: string
          created_at?: string
          created_via?: string | null
          custom_answers?: Json | null
          google_event_id?: string | null
          id?: string
          option_minutes?: number
          source?: string | null
          staff_user_id?: string | null
          status?: string
          tenant_id?: string | null
          trainer_note?: string | null
          user_id: string
        }
        Update: {
          booking_date?: string
          booking_options?: Json | null
          booking_type?: string
          created_at?: string
          created_via?: string | null
          custom_answers?: Json | null
          google_event_id?: string | null
          id?: string
          option_minutes?: number
          source?: string | null
          staff_user_id?: string | null
          status?: string
          tenant_id?: string | null
          trainer_note?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "bookings_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      counseling_responses: {
        Row: {
          age: string | null
          created_at: string
          diet_pattern: string | null
          email: string | null
          exercise_habit: string | null
          experience_level: string | null
          first_name: string
          first_name_kana: string | null
          gender: string | null
          id: string
          last_name: string
          last_name_kana: string | null
          medical_history: string | null
          notes: string | null
          pain_areas: string[] | null
          phone: string | null
          purposes: string[] | null
          reviewed: boolean
          sleep_hours: string | null
          target_frequency: string | null
          tenant_id: string | null
          trainer_memo: string | null
          ward: string | null
        }
        Insert: {
          age?: string | null
          created_at?: string
          diet_pattern?: string | null
          email?: string | null
          exercise_habit?: string | null
          experience_level?: string | null
          first_name: string
          first_name_kana?: string | null
          gender?: string | null
          id?: string
          last_name: string
          last_name_kana?: string | null
          medical_history?: string | null
          notes?: string | null
          pain_areas?: string[] | null
          phone?: string | null
          purposes?: string[] | null
          reviewed?: boolean
          sleep_hours?: string | null
          target_frequency?: string | null
          tenant_id?: string | null
          trainer_memo?: string | null
          ward?: string | null
        }
        Update: {
          age?: string | null
          created_at?: string
          diet_pattern?: string | null
          email?: string | null
          exercise_habit?: string | null
          experience_level?: string | null
          first_name?: string
          first_name_kana?: string | null
          gender?: string | null
          id?: string
          last_name?: string
          last_name_kana?: string | null
          medical_history?: string | null
          notes?: string | null
          pain_areas?: string[] | null
          phone?: string | null
          purposes?: string[] | null
          reviewed?: boolean
          sleep_hours?: string | null
          target_frequency?: string | null
          tenant_id?: string | null
          trainer_memo?: string | null
          ward?: string | null
        }
        Relationships: []
      }
      email_send_log: {
        Row: {
          created_at: string
          error_message: string | null
          id: string
          message_id: string | null
          metadata: Json | null
          recipient_email: string
          status: string
          template_data: Json | null
          template_name: string
          tenant_id: string | null
        }
        Insert: {
          created_at?: string
          error_message?: string | null
          id?: string
          message_id?: string | null
          metadata?: Json | null
          recipient_email: string
          status: string
          template_data?: Json | null
          template_name: string
          tenant_id?: string | null
        }
        Update: {
          created_at?: string
          error_message?: string | null
          id?: string
          message_id?: string | null
          metadata?: Json | null
          recipient_email?: string
          status?: string
          template_data?: Json | null
          template_name?: string
          tenant_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "email_send_log_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      email_send_state: {
        Row: {
          auth_email_ttl_minutes: number
          batch_size: number
          id: number
          retry_after_until: string | null
          send_delay_ms: number
          transactional_email_ttl_minutes: number
          updated_at: string
        }
        Insert: {
          auth_email_ttl_minutes?: number
          batch_size?: number
          id?: number
          retry_after_until?: string | null
          send_delay_ms?: number
          transactional_email_ttl_minutes?: number
          updated_at?: string
        }
        Update: {
          auth_email_ttl_minutes?: number
          batch_size?: number
          id?: number
          retry_after_until?: string | null
          send_delay_ms?: number
          transactional_email_ttl_minutes?: number
          updated_at?: string
        }
        Relationships: []
      }
      email_unsubscribe_tokens: {
        Row: {
          created_at: string
          email: string
          id: string
          token: string
          used_at: string | null
        }
        Insert: {
          created_at?: string
          email: string
          id?: string
          token: string
          used_at?: string | null
        }
        Update: {
          created_at?: string
          email?: string
          id?: string
          token?: string
          used_at?: string | null
        }
        Relationships: []
      }
      exercise_id_map: {
        Row: {
          created_at: string
          gymboard_exercise_id: string
          id: string
          salute_exercise_id: string
          tenant_id: string
        }
        Insert: {
          created_at?: string
          gymboard_exercise_id: string
          id?: string
          salute_exercise_id: string
          tenant_id: string
        }
        Update: {
          created_at?: string
          gymboard_exercise_id?: string
          id?: string
          salute_exercise_id?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "exercise_id_map_gymboard_exercise_id_fkey"
            columns: ["gymboard_exercise_id"]
            isOneToOne: false
            referencedRelation: "exercises"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "exercise_id_map_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      exercises: {
        Row: {
          category: string
          created_at: string
          default_reps: number | null
          default_sets: number | null
          default_weight: number | null
          id: string
          muscle_group: string
          name: string
          notes: string | null
          sort_order: number
          tenant_id: string | null
          updated_at: string
        }
        Insert: {
          category?: string
          created_at?: string
          default_reps?: number | null
          default_sets?: number | null
          default_weight?: number | null
          id?: string
          muscle_group?: string
          name: string
          notes?: string | null
          sort_order?: number
          tenant_id?: string | null
          updated_at?: string
        }
        Update: {
          category?: string
          created_at?: string
          default_reps?: number | null
          default_sets?: number | null
          default_weight?: number | null
          id?: string
          muscle_group?: string
          name?: string
          notes?: string | null
          sort_order?: number
          tenant_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "exercises_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      google_calendar_tokens: {
        Row: {
          access_token: string
          calendar_id: string
          created_at: string
          expires_at: string
          id: string
          refresh_token: string
          updated_at: string
          user_id: string
        }
        Insert: {
          access_token: string
          calendar_id?: string
          created_at?: string
          expires_at: string
          id?: string
          refresh_token: string
          updated_at?: string
          user_id: string
        }
        Update: {
          access_token?: string
          calendar_id?: string
          created_at?: string
          expires_at?: string
          id?: string
          refresh_token?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      gym_settings: {
        Row: {
          created_at: string
          id: string
          logo_url: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          logo_url?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          logo_url?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      gym_videos: {
        Row: {
          category: string
          created_at: string
          created_by: string | null
          description: string | null
          duration_seconds: number | null
          id: string
          published_at: string
          sort_order: number
          tenant_id: string
          title: string
          updated_at: string
          video_url: string
        }
        Insert: {
          category?: string
          created_at?: string
          created_by?: string | null
          description?: string | null
          duration_seconds?: number | null
          id?: string
          published_at?: string
          sort_order?: number
          tenant_id: string
          title: string
          updated_at?: string
          video_url: string
        }
        Update: {
          category?: string
          created_at?: string
          created_by?: string | null
          description?: string | null
          duration_seconds?: number | null
          id?: string
          published_at?: string
          sort_order?: number
          tenant_id?: string
          title?: string
          updated_at?: string
          video_url?: string
        }
        Relationships: []
      }
      meals: {
        Row: {
          analyzed: boolean
          calories: number | null
          carbs: number | null
          created_at: string
          dishes: Json | null
          fat: number | null
          feedback: string | null
          fiber: number | null
          id: string
          image_url: string
          meal_type: string
          protein: number | null
          tenant_id: string | null
          user_id: string | null
        }
        Insert: {
          analyzed?: boolean
          calories?: number | null
          carbs?: number | null
          created_at?: string
          dishes?: Json | null
          fat?: number | null
          feedback?: string | null
          fiber?: number | null
          id?: string
          image_url: string
          meal_type?: string
          protein?: number | null
          tenant_id?: string | null
          user_id?: string | null
        }
        Update: {
          analyzed?: boolean
          calories?: number | null
          carbs?: number | null
          created_at?: string
          dishes?: Json | null
          fat?: number | null
          feedback?: string | null
          fiber?: number | null
          id?: string
          image_url?: string
          meal_type?: string
          protein?: number | null
          tenant_id?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "meals_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      member_agreements: {
        Row: {
          agreed_on: string
          created_at: string
          id: string
          note: string | null
          recorded_by: string | null
          tenant_id: string
          title: string
          user_id: string
        }
        Insert: {
          agreed_on: string
          created_at?: string
          id?: string
          note?: string | null
          recorded_by?: string | null
          tenant_id: string
          title: string
          user_id: string
        }
        Update: {
          agreed_on?: string
          created_at?: string
          id?: string
          note?: string | null
          recorded_by?: string | null
          tenant_id?: string
          title?: string
          user_id?: string
        }
        Relationships: []
      }
      member_payments: {
        Row: {
          amount_yen: number
          covers_cycle_start: string | null
          created_at: string
          id: string
          kind: string
          method: string
          note: string | null
          paid_on: string
          plan_name: string | null
          recorded_by: string | null
          tenant_id: string
          user_id: string
        }
        Insert: {
          amount_yen: number
          covers_cycle_start?: string | null
          created_at?: string
          id?: string
          kind: string
          method: string
          note?: string | null
          paid_on: string
          plan_name?: string | null
          recorded_by?: string | null
          tenant_id: string
          user_id: string
        }
        Update: {
          amount_yen?: number
          covers_cycle_start?: string | null
          created_at?: string
          id?: string
          kind?: string
          method?: string
          note?: string | null
          paid_on?: string
          plan_name?: string | null
          recorded_by?: string | null
          tenant_id?: string
          user_id?: string
        }
        Relationships: []
      }
      message_reactions: {
        Row: {
          created_at: string
          id: string
          kind: string
          message_id: string
          tenant_id: string | null
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          kind: string
          message_id: string
          tenant_id?: string | null
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          kind?: string
          message_id?: string
          tenant_id?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "message_reactions_message_id_fkey"
            columns: ["message_id"]
            isOneToOne: false
            referencedRelation: "messages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "message_reactions_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      message_templates: {
        Row: {
          body: string
          created_at: string
          created_by: string | null
          id: string
          sort_order: number
          tenant_id: string
          title: string
          updated_at: string
        }
        Insert: {
          body: string
          created_at?: string
          created_by?: string | null
          id?: string
          sort_order?: number
          tenant_id: string
          title: string
          updated_at?: string
        }
        Update: {
          body?: string
          created_at?: string
          created_by?: string | null
          id?: string
          sort_order?: number
          tenant_id?: string
          title?: string
          updated_at?: string
        }
        Relationships: []
      }
      messages: {
        Row: {
          attachment_path: string | null
          attachment_type: string | null
          content: string
          created_at: string
          id: string
          read: boolean
          receiver_id: string
          sender_id: string
          sticker_id: string | null
          tenant_id: string | null
          unsent_at: string | null
        }
        Insert: {
          attachment_path?: string | null
          attachment_type?: string | null
          content: string
          created_at?: string
          id?: string
          read?: boolean
          receiver_id: string
          sender_id: string
          sticker_id?: string | null
          tenant_id?: string | null
          unsent_at?: string | null
        }
        Update: {
          attachment_path?: string | null
          attachment_type?: string | null
          content?: string
          created_at?: string
          id?: string
          read?: boolean
          receiver_id?: string
          sender_id?: string
          sticker_id?: string | null
          tenant_id?: string | null
          unsent_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "messages_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      migration_user_map: {
        Row: {
          email: string
          gymboard_user_id: string
          id: string
          migrated_at: string
          salute_user_id: string
          tenant_id: string
        }
        Insert: {
          email: string
          gymboard_user_id: string
          id?: string
          migrated_at?: string
          salute_user_id: string
          tenant_id: string
        }
        Update: {
          email?: string
          gymboard_user_id?: string
          id?: string
          migrated_at?: string
          salute_user_id?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "migration_user_map_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      monthly_reports: {
        Row: {
          created_at: string
          id: string
          month: string
          tenant_id: string | null
          trainer_comment: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          month: string
          tenant_id?: string | null
          trainer_comment?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          month?: string
          tenant_id?: string | null
          trainer_comment?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "monthly_reports_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      notification_dedupe: {
        Row: {
          idempotency_key: string
          sent_at: string
        }
        Insert: {
          idempotency_key: string
          sent_at?: string
        }
        Update: {
          idempotency_key?: string
          sent_at?: string
        }
        Relationships: []
      }
      notification_preferences: {
        Row: {
          created_at: string
          reminder_day_before: boolean
          reminder_hour_before: boolean
          reminder_period: boolean
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          reminder_day_before?: boolean
          reminder_hour_before?: boolean
          reminder_period?: boolean
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          reminder_day_before?: boolean
          reminder_hour_before?: boolean
          reminder_period?: boolean
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      notification_settings: {
        Row: {
          created_at: string
          id: string
          reminder_enabled: boolean
          tenant_id: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          reminder_enabled?: boolean
          tenant_id?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          reminder_enabled?: boolean
          tenant_id?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "notification_settings_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      oauth_states: {
        Row: {
          created_at: string
          expires_at: string
          nonce: string
          provider: string
          used_at: string | null
          user_id: string
        }
        Insert: {
          created_at?: string
          expires_at?: string
          nonce?: string
          provider: string
          used_at?: string | null
          user_id: string
        }
        Update: {
          created_at?: string
          expires_at?: string
          nonce?: string
          provider?: string
          used_at?: string | null
          user_id?: string
        }
        Relationships: []
      }
      operator_feedback: {
        Row: {
          body: string
          created_at: string
          id: string
          tenant_id: string
          user_id: string
        }
        Insert: {
          body: string
          created_at?: string
          id?: string
          tenant_id: string
          user_id: string
        }
        Update: {
          body?: string
          created_at?: string
          id?: string
          tenant_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "operator_feedback_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          avatar_url: string | null
          best_streak: number
          calendar_token: string
          claimed_at: string | null
          created_at: string
          cycle_start_date: string | null
          cycle_start_pinned: boolean
          display_name: string | null
          gender: string | null
          grace_enabled: boolean | null
          id: string
          imported_at: string | null
          invited_at: string | null
          last_streak_notified: number
          line_user_id: string | null
          milestone_goal: string | null
          milestone_goal_set_at: string | null
          name_kana: string | null
          paid_this_month: boolean
          phone: string | null
          plan: string | null
          review_prompted_at: string | null
          show_usage_period: boolean
          tenant_id: string | null
          training_goal: string | null
          trial_completed: boolean
          updated_at: string
          user_id: string
        }
        Insert: {
          avatar_url?: string | null
          best_streak?: number
          calendar_token?: string
          claimed_at?: string | null
          created_at?: string
          cycle_start_date?: string | null
          cycle_start_pinned?: boolean
          display_name?: string | null
          gender?: string | null
          grace_enabled?: boolean | null
          id?: string
          imported_at?: string | null
          invited_at?: string | null
          last_streak_notified?: number
          line_user_id?: string | null
          milestone_goal?: string | null
          milestone_goal_set_at?: string | null
          name_kana?: string | null
          paid_this_month?: boolean
          phone?: string | null
          plan?: string | null
          review_prompted_at?: string | null
          show_usage_period?: boolean
          tenant_id?: string | null
          training_goal?: string | null
          trial_completed?: boolean
          updated_at?: string
          user_id: string
        }
        Update: {
          avatar_url?: string | null
          best_streak?: number
          calendar_token?: string
          claimed_at?: string | null
          created_at?: string
          cycle_start_date?: string | null
          cycle_start_pinned?: boolean
          display_name?: string | null
          gender?: string | null
          grace_enabled?: boolean | null
          id?: string
          imported_at?: string | null
          invited_at?: string | null
          last_streak_notified?: number
          line_user_id?: string | null
          milestone_goal?: string | null
          milestone_goal_set_at?: string | null
          name_kana?: string | null
          paid_this_month?: boolean
          phone?: string | null
          plan?: string | null
          review_prompted_at?: string | null
          show_usage_period?: boolean
          tenant_id?: string | null
          training_goal?: string | null
          trial_completed?: boolean
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "profiles_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      progress_photos: {
        Row: {
          created_at: string
          id: string
          notes: string | null
          photo_type: string
          photo_url: string
          taken_date: string
          tenant_id: string | null
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          notes?: string | null
          photo_type: string
          photo_url: string
          taken_date: string
          tenant_id?: string | null
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          notes?: string | null
          photo_type?: string
          photo_url?: string
          taken_date?: string
          tenant_id?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "progress_photos_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      push_devices: {
        Row: {
          created_at: string
          device_info: Json | null
          fcm_token: string
          id: string
          platform: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          device_info?: Json | null
          fcm_token: string
          id?: string
          platform: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          device_info?: Json | null
          fcm_token?: string
          id?: string
          platform?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      push_subscriptions: {
        Row: {
          auth: string
          created_at: string
          endpoint: string
          id: string
          p256dh: string
          user_id: string
        }
        Insert: {
          auth: string
          created_at?: string
          endpoint: string
          id?: string
          p256dh: string
          user_id: string
        }
        Update: {
          auth?: string
          created_at?: string
          endpoint?: string
          id?: string
          p256dh?: string
          user_id?: string
        }
        Relationships: []
      }
      repair_skipped_bookings: {
        Row: {
          booking_date: string
          created_at: string
          gymboard_user_id: string
          id: string
          reason: string
          salute_user_id: string | null
        }
        Insert: {
          booking_date: string
          created_at?: string
          gymboard_user_id: string
          id?: string
          reason: string
          salute_user_id?: string | null
        }
        Update: {
          booking_date?: string
          created_at?: string
          gymboard_user_id?: string
          id?: string
          reason?: string
          salute_user_id?: string | null
        }
        Relationships: []
      }
      skeletal_diagnoses: {
        Row: {
          confidence: number
          created_at: string
          id: string
          image_url: string | null
          metrics: Json
          scores: Json
          skeletal_type: string
          user_id: string
        }
        Insert: {
          confidence: number
          created_at?: string
          id?: string
          image_url?: string | null
          metrics?: Json
          scores?: Json
          skeletal_type: string
          user_id: string
        }
        Update: {
          confidence?: number
          created_at?: string
          id?: string
          image_url?: string | null
          metrics?: Json
          scores?: Json
          skeletal_type?: string
          user_id?: string
        }
        Relationships: []
      }
      staff_schedules: {
        Row: {
          created_at: string
          end_time: string
          id: string
          start_time: string
          tenant_id: string
          updated_at: string
          user_id: string
          weekday: number
        }
        Insert: {
          created_at?: string
          end_time: string
          id?: string
          start_time: string
          tenant_id: string
          updated_at?: string
          user_id: string
          weekday: number
        }
        Update: {
          created_at?: string
          end_time?: string
          id?: string
          start_time?: string
          tenant_id?: string
          updated_at?: string
          user_id?: string
          weekday?: number
        }
        Relationships: [
          {
            foreignKeyName: "staff_schedules_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      suppressed_emails: {
        Row: {
          created_at: string
          email: string
          id: string
          metadata: Json | null
          reason: string
        }
        Insert: {
          created_at?: string
          email: string
          id?: string
          metadata?: Json | null
          reason: string
        }
        Update: {
          created_at?: string
          email?: string
          id?: string
          metadata?: Json | null
          reason?: string
        }
        Relationships: []
      }
      tenant_members: {
        Row: {
          cycle_start_date: string | null
          display_name: string | null
          id: string
          joined_at: string
          plan_id: string | null
          plan_start_date: string | null
          role: string
          status: string | null
          suspended_from: string | null
          suspended_until: string | null
          tenant_id: string
          ticket_expires_at: string | null
          ticket_remaining: number | null
          user_id: string
          withdrawal_reason: string | null
          withdrawn_on: string | null
        }
        Insert: {
          cycle_start_date?: string | null
          display_name?: string | null
          id?: string
          joined_at?: string
          plan_id?: string | null
          plan_start_date?: string | null
          role?: string
          status?: string | null
          suspended_from?: string | null
          suspended_until?: string | null
          tenant_id: string
          ticket_expires_at?: string | null
          ticket_remaining?: number | null
          user_id: string
          withdrawal_reason?: string | null
          withdrawn_on?: string | null
        }
        Update: {
          cycle_start_date?: string | null
          display_name?: string | null
          id?: string
          joined_at?: string
          plan_id?: string | null
          plan_start_date?: string | null
          role?: string
          status?: string | null
          suspended_from?: string | null
          suspended_until?: string | null
          tenant_id?: string
          ticket_expires_at?: string | null
          ticket_remaining?: number | null
          user_id?: string
          withdrawal_reason?: string | null
          withdrawn_on?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "tenant_members_plan_id_fkey"
            columns: ["plan_id"]
            isOneToOne: false
            referencedRelation: "tenant_plans"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tenant_members_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      tenant_muscle_groups: {
        Row: {
          created_at: string
          id: string
          name: string
          sort_order: number
          tenant_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          name: string
          sort_order?: number
          tenant_id: string
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
          sort_order?: number
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "tenant_muscle_groups_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      tenant_plans: {
        Row: {
          allow_overflow: boolean | null
          created_at: string
          cycle_months: number | null
          cycle_unit: string | null
          grace_days: number | null
          id: string
          is_active: boolean | null
          max_sessions: number | null
          plan_name: string
          plan_type: string
          price: number
          slot_duration_minutes: number | null
          sort_order: number | null
          tenant_id: string
          validity_days: number | null
        }
        Insert: {
          allow_overflow?: boolean | null
          created_at?: string
          cycle_months?: number | null
          cycle_unit?: string | null
          grace_days?: number | null
          id?: string
          is_active?: boolean | null
          max_sessions?: number | null
          plan_name: string
          plan_type?: string
          price?: number
          slot_duration_minutes?: number | null
          sort_order?: number | null
          tenant_id: string
          validity_days?: number | null
        }
        Update: {
          allow_overflow?: boolean | null
          created_at?: string
          cycle_months?: number | null
          cycle_unit?: string | null
          grace_days?: number | null
          id?: string
          is_active?: boolean | null
          max_sessions?: number | null
          plan_name?: string
          plan_type?: string
          price?: number
          slot_duration_minutes?: number | null
          sort_order?: number | null
          tenant_id?: string
          validity_days?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "tenant_plans_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      tenants: {
        Row: {
          active_client_basis: string
          address: string | null
          booking_buffer_minutes: number
          booking_capacity: number
          booking_capacity_confirmed_at: string | null
          booking_cutoff_hours: number | null
          booking_cutoff_type: string | null
          booking_email_note: string | null
          booking_window_days: number | null
          business_type: string
          cancel_policy_body: string | null
          created_at: string
          current_period_end: string | null
          daily_booking_limit: number | null
          daily_summary_enabled: boolean
          email: string | null
          follow_up_after_days: number
          google_review_url: string | null
          gym_name: string
          gym_name_short: string | null
          gymboard_plan: string | null
          gymboard_plan_period: string | null
          id: string
          invite_code: string | null
          line_url: string | null
          logo_url: string | null
          max_customers: number | null
          max_trainers: number | null
          next_cycle_payment_required: boolean
          next_cycle_payment_required_since: string | null
          operating_hours: Json | null
          owner_user_id: string | null
          phone: string | null
          primary_color: string | null
          public_theme_color: string | null
          reminder_email_note: string | null
          same_day_cancel_penalty_enabled: boolean
          show_counseling_responses: boolean
          show_nav_announcements: boolean
          show_nav_counseling: boolean
          show_nav_exercises: boolean
          show_nav_messages: boolean
          show_nav_notifications: boolean
          show_nav_trial_followups: boolean
          show_nav_videos: boolean
          show_renewal_alerts: boolean
          show_retention_alerts: boolean
          show_revenue_chart: boolean
          show_stat_active_clients: boolean
          show_stat_month_revenue: boolean
          show_stat_month_sessions: boolean
          show_stat_today_sessions: boolean
          show_today_schedule: boolean
          show_trial_followup_alert: boolean
          show_utilization_heatmap: boolean
          slot_duration_minutes: number | null
          staff_invite_code: string | null
          status: string | null
          stripe_customer_id: string | null
          stripe_subscription_id: string | null
          subscription_status: string | null
          trial_email_cancel_note: string | null
          trial_ends_at: string | null
          trial_ignores_blocked_slots: boolean
          trial_info_body: string | null
          trial_info_title: string | null
          trial_price_yen: number | null
          updated_at: string
          website_url: string | null
        }
        Insert: {
          active_client_basis?: string
          address?: string | null
          booking_buffer_minutes?: number
          booking_capacity?: number
          booking_capacity_confirmed_at?: string | null
          booking_cutoff_hours?: number | null
          booking_cutoff_type?: string | null
          booking_email_note?: string | null
          booking_window_days?: number | null
          business_type?: string
          cancel_policy_body?: string | null
          created_at?: string
          current_period_end?: string | null
          daily_booking_limit?: number | null
          daily_summary_enabled?: boolean
          email?: string | null
          follow_up_after_days?: number
          google_review_url?: string | null
          gym_name: string
          gym_name_short?: string | null
          gymboard_plan?: string | null
          gymboard_plan_period?: string | null
          id?: string
          invite_code?: string | null
          line_url?: string | null
          logo_url?: string | null
          max_customers?: number | null
          max_trainers?: number | null
          next_cycle_payment_required?: boolean
          next_cycle_payment_required_since?: string | null
          operating_hours?: Json | null
          owner_user_id?: string | null
          phone?: string | null
          primary_color?: string | null
          public_theme_color?: string | null
          reminder_email_note?: string | null
          same_day_cancel_penalty_enabled?: boolean
          show_counseling_responses?: boolean
          show_nav_announcements?: boolean
          show_nav_counseling?: boolean
          show_nav_exercises?: boolean
          show_nav_messages?: boolean
          show_nav_notifications?: boolean
          show_nav_trial_followups?: boolean
          show_nav_videos?: boolean
          show_renewal_alerts?: boolean
          show_retention_alerts?: boolean
          show_revenue_chart?: boolean
          show_stat_active_clients?: boolean
          show_stat_month_revenue?: boolean
          show_stat_month_sessions?: boolean
          show_stat_today_sessions?: boolean
          show_today_schedule?: boolean
          show_trial_followup_alert?: boolean
          show_utilization_heatmap?: boolean
          slot_duration_minutes?: number | null
          staff_invite_code?: string | null
          status?: string | null
          stripe_customer_id?: string | null
          stripe_subscription_id?: string | null
          subscription_status?: string | null
          trial_email_cancel_note?: string | null
          trial_ends_at?: string | null
          trial_ignores_blocked_slots?: boolean
          trial_info_body?: string | null
          trial_info_title?: string | null
          trial_price_yen?: number | null
          updated_at?: string
          website_url?: string | null
        }
        Update: {
          active_client_basis?: string
          address?: string | null
          booking_buffer_minutes?: number
          booking_capacity?: number
          booking_capacity_confirmed_at?: string | null
          booking_cutoff_hours?: number | null
          booking_cutoff_type?: string | null
          booking_email_note?: string | null
          booking_window_days?: number | null
          business_type?: string
          cancel_policy_body?: string | null
          created_at?: string
          current_period_end?: string | null
          daily_booking_limit?: number | null
          daily_summary_enabled?: boolean
          email?: string | null
          follow_up_after_days?: number
          google_review_url?: string | null
          gym_name?: string
          gym_name_short?: string | null
          gymboard_plan?: string | null
          gymboard_plan_period?: string | null
          id?: string
          invite_code?: string | null
          line_url?: string | null
          logo_url?: string | null
          max_customers?: number | null
          max_trainers?: number | null
          next_cycle_payment_required?: boolean
          next_cycle_payment_required_since?: string | null
          operating_hours?: Json | null
          owner_user_id?: string | null
          phone?: string | null
          primary_color?: string | null
          public_theme_color?: string | null
          reminder_email_note?: string | null
          same_day_cancel_penalty_enabled?: boolean
          show_counseling_responses?: boolean
          show_nav_announcements?: boolean
          show_nav_counseling?: boolean
          show_nav_exercises?: boolean
          show_nav_messages?: boolean
          show_nav_notifications?: boolean
          show_nav_trial_followups?: boolean
          show_nav_videos?: boolean
          show_renewal_alerts?: boolean
          show_retention_alerts?: boolean
          show_revenue_chart?: boolean
          show_stat_active_clients?: boolean
          show_stat_month_revenue?: boolean
          show_stat_month_sessions?: boolean
          show_stat_today_sessions?: boolean
          show_today_schedule?: boolean
          show_trial_followup_alert?: boolean
          show_utilization_heatmap?: boolean
          slot_duration_minutes?: number | null
          staff_invite_code?: string | null
          status?: string | null
          stripe_customer_id?: string | null
          stripe_subscription_id?: string | null
          subscription_status?: string | null
          trial_email_cancel_note?: string | null
          trial_ends_at?: string | null
          trial_ignores_blocked_slots?: boolean
          trial_info_body?: string | null
          trial_info_title?: string | null
          trial_price_yen?: number | null
          updated_at?: string
          website_url?: string | null
        }
        Relationships: []
      }
      trial_bookings: {
        Row: {
          booking_date: string
          booking_kind: string
          booking_type: string
          cancel_token: string
          created_at: string
          custom_answers: Json | null
          declined_reason: string | null
          follow_up_note: string | null
          follow_up_status: string
          followed_up_at: string | null
          google_event_id: string | null
          guest_contact: string
          guest_name: string
          id: string
          source: string | null
          status: string
          tenant_id: string
          trial_fee_status: string | null
        }
        Insert: {
          booking_date: string
          booking_kind?: string
          booking_type?: string
          cancel_token?: string
          created_at?: string
          custom_answers?: Json | null
          declined_reason?: string | null
          follow_up_note?: string | null
          follow_up_status?: string
          followed_up_at?: string | null
          google_event_id?: string | null
          guest_contact: string
          guest_name: string
          id?: string
          source?: string | null
          status?: string
          tenant_id: string
          trial_fee_status?: string | null
        }
        Update: {
          booking_date?: string
          booking_kind?: string
          booking_type?: string
          cancel_token?: string
          created_at?: string
          custom_answers?: Json | null
          declined_reason?: string | null
          follow_up_note?: string | null
          follow_up_status?: string
          followed_up_at?: string | null
          google_event_id?: string | null
          guest_contact?: string
          guest_name?: string
          id?: string
          source?: string | null
          status?: string
          tenant_id?: string
          trial_fee_status?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "trial_bookings_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      user_measurements: {
        Row: {
          body_fat: number | null
          created_at: string
          id: string
          measured_date: string
          tenant_id: string | null
          updated_at: string
          user_id: string
          weight: number | null
        }
        Insert: {
          body_fat?: number | null
          created_at?: string
          id?: string
          measured_date?: string
          tenant_id?: string | null
          updated_at?: string
          user_id: string
          weight?: number | null
        }
        Update: {
          body_fat?: number | null
          created_at?: string
          id?: string
          measured_date?: string
          tenant_id?: string | null
          updated_at?: string
          user_id?: string
          weight?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "user_measurements_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
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
      weight_journey: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          is_active: boolean
          start_date: string
          start_weight: number
          target_weight: number
          user_id: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          is_active?: boolean
          start_date?: string
          start_weight: number
          target_weight: number
          user_id: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          is_active?: boolean
          start_date?: string
          start_weight?: number
          target_weight?: number
          user_id?: string
        }
        Relationships: []
      }
      workouts: {
        Row: {
          created_at: string
          exercise_id: string
          id: string
          notes: string | null
          reps: number | null
          sets: Json | null
          tenant_id: string | null
          user_id: string
          weight: number | null
          workout_date: string
        }
        Insert: {
          created_at?: string
          exercise_id: string
          id?: string
          notes?: string | null
          reps?: number | null
          sets?: Json | null
          tenant_id?: string | null
          user_id: string
          weight?: number | null
          workout_date?: string
        }
        Update: {
          created_at?: string
          exercise_id?: string
          id?: string
          notes?: string | null
          reps?: number | null
          sets?: Json | null
          tenant_id?: string | null
          user_id?: string
          weight?: number | null
          workout_date?: string
        }
        Relationships: [
          {
            foreignKeyName: "workouts_exercise_id_fkey"
            columns: ["exercise_id"]
            isOneToOne: false
            referencedRelation: "exercises"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workouts_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      _gen_staff_invite_code: { Args: never; Returns: string }
      _workout_max_weight: {
        Args: { _sets: Json; _weight: number }
        Returns: number
      }
      assert_can_act_for: {
        Args: { _target_user_id: string }
        Returns: undefined
      }
      claim_my_profile: { Args: never; Returns: boolean }
      compute_rank_for_level: { Args: { _level: number }; Returns: string }
      create_gym_with_owner: {
        Args: {
          _muscle_groups?: string[]
          _owner_name?: string
          _plans?: Json
          _tenant: Json
        }
        Returns: {
          invite_code: string
          tenant_id: string
        }[]
      }
      current_jst_monday: { Args: never; Returns: string }
      delete_customer_cascade: {
        Args: { _customer_id: string }
        Returns: undefined
      }
      delete_email: {
        Args: { message_id: number; queue_name: string }
        Returns: boolean
      }
      delete_my_account: { Args: never; Returns: undefined }
      delete_my_gym: { Args: never; Returns: undefined }
      email_queue_dispatch: { Args: never; Returns: undefined }
      enqueue_email: {
        Args: { payload: Json; queue_name: string }
        Returns: number
      }
      ensure_starter_items: { Args: { p_user_id: string }; Returns: undefined }
      equip_item: {
        Args: { p_item_id: string; p_user_id: string }
        Returns: Json
      }
      equip_item_unchecked: {
        Args: { p_item_id: string; p_user_id: string }
        Returns: Json
      }
      get_app_release: {
        Args: { p_platform: string }
        Returns: {
          latest_version: string
          released_at: string
        }[]
      }
      get_booked_slots: {
        Args: { check_date: string }
        Returns: {
          booking_date: string
          end_booking_date: string
          status: string
        }[]
      }
      get_default_tenant_public: {
        Args: never
        Returns: {
          address: string
          gym_name: string
          gym_name_short: string
          id: string
          logo_url: string
          primary_color: string
        }[]
      }
      get_member_next_cycle_gate: {
        Args: { p_user_id: string }
        Returns: {
          cycle_end: string
          cycle_start: string
          paid: boolean
          payment_id: string
        }[]
      }
      get_my_next_cycle_payment_gate: {
        Args: { p_tenant_id: string }
        Returns: string
      }
      get_my_staff_invite_code: { Args: never; Returns: string }
      get_my_tenant_id: { Args: never; Returns: string }
      get_my_tenant_invite_code: { Args: never; Returns: string }
      get_tenant_booked_slots: {
        Args: { from_date: string; p_tenant_id: string; to_date: string }
        Returns: {
          booking_date: string
          end_booking_date: string
          staff_user_id: string
          status: string
        }[]
      }
      get_tenant_booking_options: {
        Args: { p_tenant_id: string }
        Returns: {
          description: string
          duration_minutes: number
          id: string
          name: string
          price_yen: number
          sort_order: number
        }[]
      }
      get_tenant_booking_questions: {
        Args: { p_tenant_id: string }
        Returns: {
          help_text: string
          id: string
          input_type: string
          label: string
          options: Json
          required: boolean
          sort_order: number
        }[]
      }
      get_tenant_capacity_windows: {
        Args: { p_tenant_id: string }
        Returns: {
          capacity: number
          end_time: string
          start_time: string
          weekdays: number[]
        }[]
      }
      get_tenant_closed_days: {
        Args: { from_date: string; p_tenant_id: string; to_date: string }
        Returns: {
          closed_date: string
          manual: boolean
          reason: string
        }[]
      }
      get_tenant_limit_status: { Args: { p_tenant_id: string }; Returns: Json }
      get_tenant_public: {
        Args: { p_id: string }
        Returns: {
          address: string
          booking_buffer_minutes: number
          booking_capacity: number
          booking_cutoff_hours: number
          booking_cutoff_type: string
          booking_window_days: number
          gym_name: string
          gym_name_short: string
          id: string
          logo_url: string
          operating_hours: Json
          primary_color: string
          public_theme_color: string
          slot_duration_minutes: number
          trial_ignores_blocked_slots: boolean
          trial_info_body: string
          trial_info_title: string
          trial_price_yen: number
        }[]
      }
      get_trainer_ids: {
        Args: never
        Returns: {
          user_id: string
        }[]
      }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      has_tenant_role: {
        Args: { _roles: string[]; _tenant_id: string; _user_id: string }
        Returns: boolean
      }
      import_customers: {
        Args: { _rows: Json; _tenant_id: string }
        Returns: number
      }
      initialize_starter_equipment: { Args: never; Returns: Json }
      initialize_starter_equipment_for_user: {
        Args: { p_user_id: string }
        Returns: Json
      }
      is_tenant_member: {
        Args: { _tenant_id: string; _user_id: string }
        Returns: boolean
      }
      is_tenant_over_limit: { Args: { p_tenant_id: string }; Returns: boolean }
      join_tenant_as_staff_with_invite_code: {
        Args: { p_code: string; p_display_name: string }
        Returns: string
      }
      lookup_tenant_by_invite_code: {
        Args: { p_code: string }
        Returns: {
          address: string
          gym_name: string
          id: string
          logo_url: string
          primary_color: string
        }[]
      }
      lookup_tenant_by_staff_invite_code: {
        Args: { p_code: string }
        Returns: {
          address: string
          gym_name: string
          id: string
          logo_url: string
          primary_color: string
        }[]
      }
      member_first_unpaid_cycle_start: {
        Args: { p_tenant_id: string; p_user_id: string }
        Returns: string
      }
      move_to_dlq: {
        Args: {
          dlq_name: string
          message_id: number
          payload: Json
          source_queue: string
        }
        Returns: number
      }
      plan_cycle_window:
        | {
            Args: {
              p_cycle_len: number
              p_cycle_start: string
              p_cycle_unit: string
              p_target: string
            }
            Returns: {
              window_end: string
              window_start: string
            }[]
          }
        | {
            Args: {
              p_cycle_months: number
              p_cycle_start: string
              p_target: string
            }
            Returns: {
              window_end: string
              window_start: string
            }[]
          }
      read_email_batch: {
        Args: { batch_size: number; queue_name: string; vt: number }
        Returns: {
          message: Json
          msg_id: number
          read_ct: number
        }[]
      }
      regenerate_staff_invite_code: { Args: never; Returns: string }
      remove_staff_member: { Args: { p_user_id: string }; Returns: undefined }
      resolve_booking_capacity: {
        Args: { p_booking_date: string; p_tenant_id: string }
        Returns: number
      }
      shares_tenant_with_me: {
        Args: { _target_user_id: string }
        Returns: boolean
      }
      tenant_day_booking_count: {
        Args: {
          p_date: string
          p_exclude_booking_id?: string
          p_tenant_id: string
        }
        Returns: number
      }
      tenant_day_closed: {
        Args: {
          p_date: string
          p_exclude_booking_id?: string
          p_tenant_id: string
        }
        Returns: boolean
      }
      transfer_gym_ownership: {
        Args: { _to_user_id: string }
        Returns: undefined
      }
      unsend_message: { Args: { _message_id: string }; Returns: string }
    }
    Enums: {
      app_role: "customer" | "trainer"
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
      app_role: ["customer", "trainer"],
    },
  },
} as const
