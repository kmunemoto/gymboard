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
      avatar_achievements: {
        Row: {
          achievement_key: string
          id: string
          unlocked_at: string
          user_id: string
        }
        Insert: {
          achievement_key: string
          id?: string
          unlocked_at?: string
          user_id: string
        }
        Update: {
          achievement_key?: string
          id?: string
          unlocked_at?: string
          user_id?: string
        }
        Relationships: []
      }
      avatar_collection_rewards: {
        Row: {
          coins_awarded: number
          created_at: string
          id: string
          milestone: number
          user_id: string
        }
        Insert: {
          coins_awarded?: number
          created_at?: string
          id?: string
          milestone: number
          user_id: string
        }
        Update: {
          coins_awarded?: number
          created_at?: string
          id?: string
          milestone?: number
          user_id?: string
        }
        Relationships: []
      }
      avatar_customization_items: {
        Row: {
          category: string
          created_at: string
          id: string
          item_key: string
          name: string
          price: number
          rarity: string
          required_level: number
          sort_order: number
        }
        Insert: {
          category: string
          created_at?: string
          id?: string
          item_key: string
          name: string
          price?: number
          rarity?: string
          required_level?: number
          sort_order?: number
        }
        Update: {
          category?: string
          created_at?: string
          id?: string
          item_key?: string
          name?: string
          price?: number
          rarity?: string
          required_level?: number
          sort_order?: number
        }
        Relationships: []
      }
      avatar_exp_logs: {
        Row: {
          created_at: string
          exp_amount: number
          id: string
          reason: string
          reference_date: string | null
          user_id: string
        }
        Insert: {
          created_at?: string
          exp_amount: number
          id?: string
          reason: string
          reference_date?: string | null
          user_id: string
        }
        Update: {
          created_at?: string
          exp_amount?: number
          id?: string
          reason?: string
          reference_date?: string | null
          user_id?: string
        }
        Relationships: []
      }
      avatar_frames: {
        Row: {
          created_at: string
          frame_key: string
          frame_name: string
          id: string
          image_path: string
          rarity: string
          sort_order: number
        }
        Insert: {
          created_at?: string
          frame_key: string
          frame_name: string
          id?: string
          image_path: string
          rarity: string
          sort_order?: number
        }
        Update: {
          created_at?: string
          frame_key?: string
          frame_name?: string
          id?: string
          image_path?: string
          rarity?: string
          sort_order?: number
        }
        Relationships: []
      }
      avatar_rank_up_rewards: {
        Row: {
          coins_awarded: number
          created_at: string
          id: string
          rank_name: string
          tickets_awarded: number
          user_id: string
        }
        Insert: {
          coins_awarded?: number
          created_at?: string
          id?: string
          rank_name: string
          tickets_awarded?: number
          user_id: string
        }
        Update: {
          coins_awarded?: number
          created_at?: string
          id?: string
          rank_name?: string
          tickets_awarded?: number
          user_id?: string
        }
        Relationships: []
      }
      battle_items: {
        Row: {
          created_at: string
          description: string
          effect_amount: number
          effect_type: string
          icon_name: string | null
          id: string
          item_key: string
          item_name: string
          shop_price: number | null
        }
        Insert: {
          created_at?: string
          description: string
          effect_amount?: number
          effect_type: string
          icon_name?: string | null
          id?: string
          item_key: string
          item_name: string
          shop_price?: number | null
        }
        Update: {
          created_at?: string
          description?: string
          effect_amount?: number
          effect_type?: string
          icon_name?: string | null
          id?: string
          item_key?: string
          item_name?: string
          shop_price?: number | null
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
      coin_purchases: {
        Row: {
          amount_jpy: number
          coins_added: number
          created_at: string
          environment: string
          id: string
          is_refund: boolean
          price_id: string
          refund_of_session_id: string | null
          stripe_payment_intent_id: string | null
          stripe_session_id: string
          user_id: string
        }
        Insert: {
          amount_jpy: number
          coins_added: number
          created_at?: string
          environment?: string
          id?: string
          is_refund?: boolean
          price_id: string
          refund_of_session_id?: string | null
          stripe_payment_intent_id?: string | null
          stripe_session_id: string
          user_id: string
        }
        Update: {
          amount_jpy?: number
          coins_added?: number
          created_at?: string
          environment?: string
          id?: string
          is_refund?: boolean
          price_id?: string
          refund_of_session_id?: string | null
          stripe_payment_intent_id?: string | null
          stripe_session_id?: string
          user_id?: string
        }
        Relationships: []
      }
      companion_defs: {
        Row: {
          base_atk: number
          base_def: number
          base_hp: number
          companion_key: string
          companion_name: string
          element: string
          evolution_stage: number
          evolve_level: number | null
          evolves_from: string | null
          id: string
          image_path: string
          rarity: string
          skill_description: string
          skill_name: string
          skill_power: number
          skill_type: string
        }
        Insert: {
          base_atk: number
          base_def: number
          base_hp: number
          companion_key: string
          companion_name: string
          element: string
          evolution_stage?: number
          evolve_level?: number | null
          evolves_from?: string | null
          id?: string
          image_path: string
          rarity?: string
          skill_description: string
          skill_name: string
          skill_power?: number
          skill_type?: string
        }
        Update: {
          base_atk?: number
          base_def?: number
          base_hp?: number
          companion_key?: string
          companion_name?: string
          element?: string
          evolution_stage?: number
          evolve_level?: number | null
          evolves_from?: string | null
          id?: string
          image_path?: string
          rarity?: string
          skill_description?: string
          skill_name?: string
          skill_power?: number
          skill_type?: string
        }
        Relationships: []
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
      craft_materials: {
        Row: {
          description: string | null
          icon_name: string | null
          id: string
          material_key: string
          material_name: string
          rarity: string
        }
        Insert: {
          description?: string | null
          icon_name?: string | null
          id?: string
          material_key: string
          material_name: string
          rarity?: string
        }
        Update: {
          description?: string | null
          icon_name?: string | null
          id?: string
          material_key?: string
          material_name?: string
          rarity?: string
        }
        Relationships: []
      }
      daily_login_bonuses: {
        Row: {
          claimed_at: string
          day_number: number
          id: string
          login_date: string
          reward_amount: number
          reward_type: string
          user_id: string
        }
        Insert: {
          claimed_at?: string
          day_number: number
          id?: string
          login_date: string
          reward_amount: number
          reward_type: string
          user_id: string
        }
        Update: {
          claimed_at?: string
          day_number?: number
          id?: string
          login_date?: string
          reward_amount?: number
          reward_type?: string
          user_id?: string
        }
        Relationships: []
      }
      daily_missions: {
        Row: {
          all_completed: boolean
          completed_keys: string[]
          created_at: string
          exp_earned: number
          id: string
          mission_date: string
          mission_keys: string[]
          user_id: string
        }
        Insert: {
          all_completed?: boolean
          completed_keys?: string[]
          created_at?: string
          exp_earned?: number
          id?: string
          mission_date: string
          mission_keys: string[]
          user_id: string
        }
        Update: {
          all_completed?: boolean
          completed_keys?: string[]
          created_at?: string
          exp_earned?: number
          id?: string
          mission_date?: string
          mission_keys?: string[]
          user_id?: string
        }
        Relationships: []
      }
      dungeon_monsters: {
        Row: {
          atk: number
          coin_reward: number
          created_at: string
          def: number
          drop_material_key: string | null
          drop_material_rate: number | null
          drop_ticket_rate: number | null
          exp_reward: number
          floor_number: number
          hp: number
          icon_name: string | null
          id: string
          is_boss: boolean
          monster_count: number
          monster_key: string
          monster_level: number
          monster_name: string
          monster_skills: Json | null
          stage_key: string
        }
        Insert: {
          atk: number
          coin_reward?: number
          created_at?: string
          def: number
          drop_material_key?: string | null
          drop_material_rate?: number | null
          drop_ticket_rate?: number | null
          exp_reward?: number
          floor_number: number
          hp: number
          icon_name?: string | null
          id?: string
          is_boss?: boolean
          monster_count?: number
          monster_key: string
          monster_level?: number
          monster_name: string
          monster_skills?: Json | null
          stage_key: string
        }
        Update: {
          atk?: number
          coin_reward?: number
          created_at?: string
          def?: number
          drop_material_key?: string | null
          drop_material_rate?: number | null
          drop_ticket_rate?: number | null
          exp_reward?: number
          floor_number?: number
          hp?: number
          icon_name?: string | null
          id?: string
          is_boss?: boolean
          monster_count?: number
          monster_key?: string
          monster_level?: number
          monster_name?: string
          monster_skills?: Json | null
          stage_key?: string
        }
        Relationships: [
          {
            foreignKeyName: "dungeon_monsters_stage_key_fkey"
            columns: ["stage_key"]
            isOneToOne: false
            referencedRelation: "dungeon_stages"
            referencedColumns: ["stage_key"]
          },
        ]
      }
      dungeon_runs: {
        Row: {
          completed_at: string | null
          created_at: string
          floors_cleared: number
          id: string
          result: string
          stage_key: string
          started_at: string
          total_coins: number
          total_exp: number
          user_id: string
        }
        Insert: {
          completed_at?: string | null
          created_at?: string
          floors_cleared?: number
          id?: string
          result?: string
          stage_key: string
          started_at?: string
          total_coins?: number
          total_exp?: number
          user_id: string
        }
        Update: {
          completed_at?: string | null
          created_at?: string
          floors_cleared?: number
          id?: string
          result?: string
          stage_key?: string
          started_at?: string
          total_coins?: number
          total_exp?: number
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "dungeon_runs_stage_key_fkey"
            columns: ["stage_key"]
            isOneToOne: false
            referencedRelation: "dungeon_stages"
            referencedColumns: ["stage_key"]
          },
        ]
      }
      dungeon_stages: {
        Row: {
          background_css: string | null
          created_at: string
          floor_count: number
          id: string
          recommended_level_max: number | null
          recommended_level_min: number | null
          stage_key: string
          stage_name: string
          stage_order: number
          unlock_condition: string | null
        }
        Insert: {
          background_css?: string | null
          created_at?: string
          floor_count?: number
          id?: string
          recommended_level_max?: number | null
          recommended_level_min?: number | null
          stage_key: string
          stage_name: string
          stage_order: number
          unlock_condition?: string | null
        }
        Update: {
          background_css?: string | null
          created_at?: string
          floor_count?: number
          id?: string
          recommended_level_max?: number | null
          recommended_level_min?: number | null
          stage_key?: string
          stage_name?: string
          stage_order?: number
          unlock_condition?: string | null
        }
        Relationships: []
      }
      dungeon_story: {
        Row: {
          id: string
          message: string
          sort_order: number
          speaker: string | null
          stage_key: string
          timing: string
        }
        Insert: {
          id?: string
          message: string
          sort_order?: number
          speaker?: string | null
          stage_key: string
          timing: string
        }
        Update: {
          id?: string
          message?: string
          sort_order?: number
          speaker?: string | null
          stage_key?: string
          timing?: string
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
      equipment_items: {
        Row: {
          atk_bonus: number
          created_at: string
          def_bonus: number
          hp_bonus: number
          icon_name: string
          id: string
          image_path: string | null
          item_key: string
          item_name: string
          item_type: string
          rarity: string
          source: string
        }
        Insert: {
          atk_bonus?: number
          created_at?: string
          def_bonus?: number
          hp_bonus?: number
          icon_name: string
          id?: string
          image_path?: string | null
          item_key: string
          item_name: string
          item_type: string
          rarity: string
          source: string
        }
        Update: {
          atk_bonus?: number
          created_at?: string
          def_bonus?: number
          hp_bonus?: number
          icon_name?: string
          id?: string
          image_path?: string | null
          item_key?: string
          item_name?: string
          item_type?: string
          rarity?: string
          source?: string
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
      gacha_results: {
        Row: {
          created_at: string
          id: string
          rarity: string
          result_date: string
          reward_amount: number | null
          reward_key: string | null
          reward_type: string
          ticket_id: string | null
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          rarity: string
          result_date: string
          reward_amount?: number | null
          reward_key?: string | null
          reward_type: string
          ticket_id?: string | null
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          rarity?: string
          result_date?: string
          reward_amount?: number | null
          reward_key?: string | null
          reward_type?: string
          ticket_id?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "gacha_results_ticket_id_fkey"
            columns: ["ticket_id"]
            isOneToOne: false
            referencedRelation: "user_gacha_tickets"
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
      player_skills: {
        Row: {
          buff_multiplier: number | null
          buff_turns: number | null
          buff_type: string | null
          created_at: string
          description: string
          heal_amount: number | null
          icon_name: string | null
          id: string
          mp_cost: number
          power: number
          required_level: number
          skill_key: string
          skill_name: string
          skill_type: string
        }
        Insert: {
          buff_multiplier?: number | null
          buff_turns?: number | null
          buff_type?: string | null
          created_at?: string
          description: string
          heal_amount?: number | null
          icon_name?: string | null
          id?: string
          mp_cost?: number
          power?: number
          required_level?: number
          skill_key: string
          skill_name: string
          skill_type?: string
        }
        Update: {
          buff_multiplier?: number | null
          buff_turns?: number | null
          buff_type?: string | null
          created_at?: string
          description?: string
          heal_amount?: number | null
          icon_name?: string | null
          id?: string
          mp_cost?: number
          power?: number
          required_level?: number
          skill_key?: string
          skill_name?: string
          skill_type?: string
        }
        Relationships: []
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
          game_mode_enabled: boolean
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
          game_mode_enabled?: boolean
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
          game_mode_enabled?: boolean
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
      quest_battle_logs: {
        Row: {
          boss_atk: number
          boss_counter_damage: number
          boss_def: number
          boss_hp_after: number
          boss_hp_before: number
          created_at: string
          damage_dealt: number
          id: string
          is_boss_defeated: boolean
          is_full_power: boolean
          player_atk: number
          player_def: number
          player_hp: number
          session_volume: number
          stage_id: number
          user_id: string
        }
        Insert: {
          boss_atk: number
          boss_counter_damage: number
          boss_def: number
          boss_hp_after: number
          boss_hp_before: number
          created_at?: string
          damage_dealt: number
          id?: string
          is_boss_defeated?: boolean
          is_full_power: boolean
          player_atk: number
          player_def: number
          player_hp: number
          session_volume?: number
          stage_id: number
          user_id: string
        }
        Update: {
          boss_atk?: number
          boss_counter_damage?: number
          boss_def?: number
          boss_hp_after?: number
          boss_hp_before?: number
          created_at?: string
          damage_dealt?: number
          id?: string
          is_boss_defeated?: boolean
          is_full_power?: boolean
          player_atk?: number
          player_def?: number
          player_hp?: number
          session_volume?: number
          stage_id?: number
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "quest_battle_logs_stage_id_fkey"
            columns: ["stage_id"]
            isOneToOne: false
            referencedRelation: "quest_stages"
            referencedColumns: ["id"]
          },
        ]
      }
      quest_bosses: {
        Row: {
          boss_atk: number
          boss_def: number
          boss_description: string
          boss_hp: number
          boss_icon: string
          boss_image_url: string | null
          boss_name: string
          created_at: string
          gender: string
          id: number
          stage_id: number
        }
        Insert: {
          boss_atk: number
          boss_def: number
          boss_description: string
          boss_hp: number
          boss_icon?: string
          boss_image_url?: string | null
          boss_name: string
          created_at?: string
          gender?: string
          id?: number
          stage_id: number
        }
        Update: {
          boss_atk?: number
          boss_def?: number
          boss_description?: string
          boss_hp?: number
          boss_icon?: string
          boss_image_url?: string | null
          boss_name?: string
          created_at?: string
          gender?: string
          id?: number
          stage_id?: number
        }
        Relationships: [
          {
            foreignKeyName: "quest_bosses_stage_id_fkey"
            columns: ["stage_id"]
            isOneToOne: false
            referencedRelation: "quest_stages"
            referencedColumns: ["id"]
          },
        ]
      }
      quest_stage_conditions: {
        Row: {
          condition_type: string
          display_label: string
          id: string
          sort_order: number
          stage_id: number
          target_value: number
        }
        Insert: {
          condition_type: string
          display_label: string
          id?: string
          sort_order?: number
          stage_id: number
          target_value: number
        }
        Update: {
          condition_type?: string
          display_label?: string
          id?: string
          sort_order?: number
          stage_id?: number
          target_value?: number
        }
        Relationships: [
          {
            foreignKeyName: "quest_stage_conditions_stage_id_fkey"
            columns: ["stage_id"]
            isOneToOne: false
            referencedRelation: "quest_stages"
            referencedColumns: ["id"]
          },
        ]
      }
      quest_stages: {
        Row: {
          background_image_url: string | null
          created_at: string
          description: string
          id: number
          name: string
          name_before: string
          reward_badge_key: string | null
          reward_coins: number
          reward_exp: number
          reward_frame: boolean
          reward_title: string | null
          stage_number: number
          story_complete: string
          story_intro: string
          theme_dark_from: string
          theme_dark_to: string
          theme_gradient_from: string
          theme_gradient_to: string
          theme_icon: string
        }
        Insert: {
          background_image_url?: string | null
          created_at?: string
          description: string
          id: number
          name: string
          name_before: string
          reward_badge_key?: string | null
          reward_coins: number
          reward_exp: number
          reward_frame?: boolean
          reward_title?: string | null
          stage_number: number
          story_complete: string
          story_intro: string
          theme_dark_from: string
          theme_dark_to: string
          theme_gradient_from: string
          theme_gradient_to: string
          theme_icon: string
        }
        Update: {
          background_image_url?: string | null
          created_at?: string
          description?: string
          id?: number
          name?: string
          name_before?: string
          reward_badge_key?: string | null
          reward_coins?: number
          reward_exp?: number
          reward_frame?: boolean
          reward_title?: string | null
          stage_number?: number
          story_complete?: string
          story_intro?: string
          theme_dark_from?: string
          theme_dark_to?: string
          theme_gradient_from?: string
          theme_gradient_to?: string
          theme_icon?: string
        }
        Relationships: []
      }
      raid_bosses: {
        Row: {
          boss_hp: number
          boss_image_url: string | null
          boss_name: string
          boss_video_url: string | null
          created_at: string
          current_damage: number
          defeated: boolean
          defeated_at: string | null
          end_date: string
          id: string
          reward_coins: number
          reward_exp: number
          start_date: string
          theme_color: string | null
        }
        Insert: {
          boss_hp: number
          boss_image_url?: string | null
          boss_name: string
          boss_video_url?: string | null
          created_at?: string
          current_damage?: number
          defeated?: boolean
          defeated_at?: string | null
          end_date: string
          id?: string
          reward_coins?: number
          reward_exp?: number
          start_date: string
          theme_color?: string | null
        }
        Update: {
          boss_hp?: number
          boss_image_url?: string | null
          boss_name?: string
          boss_video_url?: string | null
          created_at?: string
          current_damage?: number
          defeated?: boolean
          defeated_at?: string | null
          end_date?: string
          id?: string
          reward_coins?: number
          reward_exp?: number
          start_date?: string
          theme_color?: string | null
        }
        Relationships: []
      }
      raid_damage_logs: {
        Row: {
          created_at: string
          damage: number
          id: string
          raid_id: string
          user_id: string
          workout_date: string
        }
        Insert: {
          created_at?: string
          damage: number
          id?: string
          raid_id: string
          user_id: string
          workout_date: string
        }
        Update: {
          created_at?: string
          damage?: number
          id?: string
          raid_id?: string
          user_id?: string
          workout_date?: string
        }
        Relationships: [
          {
            foreignKeyName: "raid_damage_logs_raid_id_fkey"
            columns: ["raid_id"]
            isOneToOne: false
            referencedRelation: "raid_bosses"
            referencedColumns: ["id"]
          },
        ]
      }
      raid_reward_items: {
        Row: {
          category: string
          created_at: string
          description: string | null
          id: string
          image_url: string | null
          item_key: string
          name: string
          raid_boss_id: string | null
          required_rank: string
          theme_color: string | null
        }
        Insert: {
          category: string
          created_at?: string
          description?: string | null
          id?: string
          image_url?: string | null
          item_key: string
          name: string
          raid_boss_id?: string | null
          required_rank: string
          theme_color?: string | null
        }
        Update: {
          category?: string
          created_at?: string
          description?: string | null
          id?: string
          image_url?: string | null
          item_key?: string
          name?: string
          raid_boss_id?: string | null
          required_rank?: string
          theme_color?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "raid_reward_items_raid_boss_id_fkey"
            columns: ["raid_boss_id"]
            isOneToOne: false
            referencedRelation: "raid_bosses"
            referencedColumns: ["id"]
          },
        ]
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
      rival_battle_entries: {
        Row: {
          entered_at: string
          id: string
          matched: boolean
          user_id: string
          week_start: string
        }
        Insert: {
          entered_at?: string
          id?: string
          matched?: boolean
          user_id: string
          week_start: string
        }
        Update: {
          entered_at?: string
          id?: string
          matched?: boolean
          user_id?: string
          week_start?: string
        }
        Relationships: []
      }
      rival_battle_rewards: {
        Row: {
          battle_id: string
          claimed: boolean
          claimed_at: string | null
          coins_earned: number
          created_at: string
          exp_earned: number
          id: string
          result: string
          streak_bonus_coins: number
          user_id: string
          win_streak: number
        }
        Insert: {
          battle_id: string
          claimed?: boolean
          claimed_at?: string | null
          coins_earned: number
          created_at?: string
          exp_earned: number
          id?: string
          result: string
          streak_bonus_coins?: number
          user_id: string
          win_streak?: number
        }
        Update: {
          battle_id?: string
          claimed?: boolean
          claimed_at?: string | null
          coins_earned?: number
          created_at?: string
          exp_earned?: number
          id?: string
          result?: string
          streak_bonus_coins?: number
          user_id?: string
          win_streak?: number
        }
        Relationships: [
          {
            foreignKeyName: "rival_battle_rewards_battle_id_fkey"
            columns: ["battle_id"]
            isOneToOne: false
            referencedRelation: "rival_battles"
            referencedColumns: ["id"]
          },
        ]
      }
      rival_battles: {
        Row: {
          completed_at: string | null
          created_at: string
          id: string
          player1_id: string
          player1_volume: number
          player2_id: string
          player2_volume: number
          status: string
          week_end: string
          week_start: string
          winner_id: string | null
        }
        Insert: {
          completed_at?: string | null
          created_at?: string
          id?: string
          player1_id: string
          player1_volume?: number
          player2_id: string
          player2_volume?: number
          status?: string
          week_end: string
          week_start: string
          winner_id?: string | null
        }
        Update: {
          completed_at?: string | null
          created_at?: string
          id?: string
          player1_id?: string
          player1_volume?: number
          player2_id?: string
          player2_volume?: number
          status?: string
          week_end?: string
          week_start?: string
          winner_id?: string | null
        }
        Relationships: []
      }
      season_event_tasks: {
        Row: {
          created_at: string
          event_id: string
          id: string
          sort_order: number
          target_value: number
          task_description: string | null
          task_icon: string | null
          task_key: string
          task_name: string
          task_type: string
        }
        Insert: {
          created_at?: string
          event_id: string
          id?: string
          sort_order?: number
          target_value: number
          task_description?: string | null
          task_icon?: string | null
          task_key: string
          task_name: string
          task_type: string
        }
        Update: {
          created_at?: string
          event_id?: string
          id?: string
          sort_order?: number
          target_value?: number
          task_description?: string | null
          task_icon?: string | null
          task_key?: string
          task_name?: string
          task_type?: string
        }
        Relationships: [
          {
            foreignKeyName: "season_event_tasks_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "season_events"
            referencedColumns: ["id"]
          },
        ]
      }
      season_events: {
        Row: {
          badge_icon: string | null
          badge_name: string | null
          created_at: string
          end_date: string
          event_description: string | null
          event_icon: string | null
          event_name: string
          id: string
          is_active: boolean
          reward_badge_key: string | null
          reward_coins: number
          reward_exp: number
          start_date: string
        }
        Insert: {
          badge_icon?: string | null
          badge_name?: string | null
          created_at?: string
          end_date: string
          event_description?: string | null
          event_icon?: string | null
          event_name: string
          id?: string
          is_active?: boolean
          reward_badge_key?: string | null
          reward_coins?: number
          reward_exp?: number
          start_date: string
        }
        Update: {
          badge_icon?: string | null
          badge_name?: string | null
          created_at?: string
          end_date?: string
          event_description?: string | null
          event_icon?: string | null
          event_name?: string
          id?: string
          is_active?: boolean
          reward_badge_key?: string | null
          reward_coins?: number
          reward_exp?: number
          start_date?: string
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
          gamification_enabled: boolean | null
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
          operating_hours: Json | null
          owner_user_id: string | null
          phone: string | null
          primary_color: string | null
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
          trial_info_body: string | null
          trial_info_title: string | null
          trial_price_yen: number | null
          updated_at: string
          website_url: string | null
        }
        Insert: {
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
          gamification_enabled?: boolean | null
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
          operating_hours?: Json | null
          owner_user_id?: string | null
          phone?: string | null
          primary_color?: string | null
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
          trial_info_body?: string | null
          trial_info_title?: string | null
          trial_price_yen?: number | null
          updated_at?: string
          website_url?: string | null
        }
        Update: {
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
          gamification_enabled?: boolean | null
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
          operating_hours?: Json | null
          owner_user_id?: string | null
          phone?: string | null
          primary_color?: string | null
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
          trial_info_body?: string | null
          trial_info_title?: string | null
          trial_price_yen?: number | null
          updated_at?: string
          website_url?: string | null
        }
        Relationships: []
      }
      training_milestones: {
        Row: {
          created_at: string
          id: number
          milestone_name: string
          reward_badge_key: string | null
          reward_coins: number
          reward_exp: number
          reward_gacha_tickets: number
          reward_title: string | null
          session_count: number
        }
        Insert: {
          created_at?: string
          id: number
          milestone_name: string
          reward_badge_key?: string | null
          reward_coins?: number
          reward_exp?: number
          reward_gacha_tickets?: number
          reward_title?: string | null
          session_count: number
        }
        Update: {
          created_at?: string
          id?: number
          milestone_name?: string
          reward_badge_key?: string | null
          reward_coins?: number
          reward_exp?: number
          reward_gacha_tickets?: number
          reward_title?: string | null
          session_count?: number
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
      user_avatars: {
        Row: {
          coins: number
          combo_5_count: number
          combo_count: number
          created_at: string
          current_mp: number
          equipped_background: string | null
          equipped_emote: string | null
          equipped_frame: string | null
          equipped_title: string | null
          equipped_weapon: string | null
          featured_badges: string[]
          gender: string | null
          hair_color: string
          id: string
          last_session_date: string | null
          level: number
          max_combo_reached: number
          max_mp: number
          total_exp: number
          updated_at: string
          user_id: string
        }
        Insert: {
          coins?: number
          combo_5_count?: number
          combo_count?: number
          created_at?: string
          current_mp?: number
          equipped_background?: string | null
          equipped_emote?: string | null
          equipped_frame?: string | null
          equipped_title?: string | null
          equipped_weapon?: string | null
          featured_badges?: string[]
          gender?: string | null
          hair_color?: string
          id?: string
          last_session_date?: string | null
          level?: number
          max_combo_reached?: number
          max_mp?: number
          total_exp?: number
          updated_at?: string
          user_id: string
        }
        Update: {
          coins?: number
          combo_5_count?: number
          combo_count?: number
          created_at?: string
          current_mp?: number
          equipped_background?: string | null
          equipped_emote?: string | null
          equipped_frame?: string | null
          equipped_title?: string | null
          equipped_weapon?: string | null
          featured_badges?: string[]
          gender?: string | null
          hair_color?: string
          id?: string
          last_session_date?: string | null
          level?: number
          max_combo_reached?: number
          max_mp?: number
          total_exp?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      user_battle_items: {
        Row: {
          id: string
          item_key: string
          quantity: number
          user_id: string
        }
        Insert: {
          id?: string
          item_key: string
          quantity?: number
          user_id: string
        }
        Update: {
          id?: string
          item_key?: string
          quantity?: number
          user_id?: string
        }
        Relationships: []
      }
      user_companions: {
        Row: {
          base_atk: number
          base_def: number
          base_hp: number
          companion_key: string
          companion_name: string
          created_at: string
          element: string
          exp: number
          fed_today: boolean
          feed_streak: number
          icon_name: string | null
          id: string
          image_path: string | null
          is_active: boolean
          last_fed_at: string | null
          level: number
          user_id: string
        }
        Insert: {
          base_atk?: number
          base_def?: number
          base_hp?: number
          companion_key: string
          companion_name: string
          created_at?: string
          element?: string
          exp?: number
          fed_today?: boolean
          feed_streak?: number
          icon_name?: string | null
          id?: string
          image_path?: string | null
          is_active?: boolean
          last_fed_at?: string | null
          level?: number
          user_id: string
        }
        Update: {
          base_atk?: number
          base_def?: number
          base_hp?: number
          companion_key?: string
          companion_name?: string
          created_at?: string
          element?: string
          exp?: number
          fed_today?: boolean
          feed_streak?: number
          icon_name?: string | null
          id?: string
          image_path?: string | null
          is_active?: boolean
          last_fed_at?: string | null
          level?: number
          user_id?: string
        }
        Relationships: []
      }
      user_customization_items: {
        Row: {
          acquired_at: string
          id: string
          item_key: string
          user_id: string
        }
        Insert: {
          acquired_at?: string
          id?: string
          item_key: string
          user_id: string
        }
        Update: {
          acquired_at?: string
          id?: string
          item_key?: string
          user_id?: string
        }
        Relationships: []
      }
      user_equipment: {
        Row: {
          equipped: boolean
          id: string
          item_id: string
          obtained_at: string
          user_id: string
        }
        Insert: {
          equipped?: boolean
          id?: string
          item_id: string
          obtained_at?: string
          user_id: string
        }
        Update: {
          equipped?: boolean
          id?: string
          item_id?: string
          obtained_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_equipment_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "equipment_items"
            referencedColumns: ["id"]
          },
        ]
      }
      user_event_completion: {
        Row: {
          completed_at: string
          event_id: string
          id: string
          user_id: string
        }
        Insert: {
          completed_at?: string
          event_id: string
          id?: string
          user_id: string
        }
        Update: {
          completed_at?: string
          event_id?: string
          id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_event_completion_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "season_events"
            referencedColumns: ["id"]
          },
        ]
      }
      user_event_progress: {
        Row: {
          completed: boolean
          completed_at: string | null
          current_value: number
          event_id: string
          id: string
          task_id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          completed?: boolean
          completed_at?: string | null
          current_value?: number
          event_id: string
          id?: string
          task_id: string
          updated_at?: string
          user_id: string
        }
        Update: {
          completed?: boolean
          completed_at?: string | null
          current_value?: number
          event_id?: string
          id?: string
          task_id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_event_progress_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "season_events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_event_progress_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "season_event_tasks"
            referencedColumns: ["id"]
          },
        ]
      }
      user_frame_inventory: {
        Row: {
          frame_key: string
          id: string
          obtained_at: string
          obtained_via: string
          user_id: string
        }
        Insert: {
          frame_key: string
          id?: string
          obtained_at?: string
          obtained_via?: string
          user_id: string
        }
        Update: {
          frame_key?: string
          id?: string
          obtained_at?: string
          obtained_via?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_frame_inventory_frame_key_fkey"
            columns: ["frame_key"]
            isOneToOne: false
            referencedRelation: "avatar_frames"
            referencedColumns: ["frame_key"]
          },
        ]
      }
      user_gacha_tickets: {
        Row: {
          created_at: string
          id: string
          session_date: string | null
          ticket_seq: number
          used: boolean
          used_at: string | null
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          session_date?: string | null
          ticket_seq?: number
          used?: boolean
          used_at?: string | null
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          session_date?: string | null
          ticket_seq?: number
          used?: boolean
          used_at?: string | null
          user_id?: string
        }
        Relationships: []
      }
      user_materials: {
        Row: {
          id: string
          material_key: string
          quantity: number
          user_id: string
        }
        Insert: {
          id?: string
          material_key: string
          quantity?: number
          user_id: string
        }
        Update: {
          id?: string
          material_key?: string
          quantity?: number
          user_id?: string
        }
        Relationships: []
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
      user_milestone_claims: {
        Row: {
          claimed_at: string
          id: string
          milestone_id: number
          user_id: string
        }
        Insert: {
          claimed_at?: string
          id?: string
          milestone_id: number
          user_id: string
        }
        Update: {
          claimed_at?: string
          id?: string
          milestone_id?: number
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_milestone_claims_milestone_id_fkey"
            columns: ["milestone_id"]
            isOneToOne: false
            referencedRelation: "training_milestones"
            referencedColumns: ["id"]
          },
        ]
      }
      user_quest_boss_progress: {
        Row: {
          boss_current_hp: number
          created_at: string
          defeated: boolean
          defeated_at: string | null
          id: string
          stage_id: number
          total_damage_dealt: number
          total_turns: number
          updated_at: string
          user_id: string
        }
        Insert: {
          boss_current_hp: number
          created_at?: string
          defeated?: boolean
          defeated_at?: string | null
          id?: string
          stage_id: number
          total_damage_dealt?: number
          total_turns?: number
          updated_at?: string
          user_id: string
        }
        Update: {
          boss_current_hp?: number
          created_at?: string
          defeated?: boolean
          defeated_at?: string | null
          id?: string
          stage_id?: number
          total_damage_dealt?: number
          total_turns?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_quest_boss_progress_stage_id_fkey"
            columns: ["stage_id"]
            isOneToOne: false
            referencedRelation: "quest_stages"
            referencedColumns: ["id"]
          },
        ]
      }
      user_quest_progress: {
        Row: {
          created_at: string
          current_stage: number
          id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          current_stage?: number
          id?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          current_stage?: number
          id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      user_quest_stage_completions: {
        Row: {
          completed_at: string
          id: string
          rewards_claimed: boolean
          stage_id: number
          user_id: string
        }
        Insert: {
          completed_at?: string
          id?: string
          rewards_claimed?: boolean
          stage_id: number
          user_id: string
        }
        Update: {
          completed_at?: string
          id?: string
          rewards_claimed?: boolean
          stage_id?: number
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_quest_stage_completions_stage_id_fkey"
            columns: ["stage_id"]
            isOneToOne: false
            referencedRelation: "quest_stages"
            referencedColumns: ["id"]
          },
        ]
      }
      user_raid_rewards: {
        Row: {
          earned_at: string
          earned_rank: string
          id: string
          item_key: string
          raid_boss_id: string | null
          user_id: string
        }
        Insert: {
          earned_at?: string
          earned_rank: string
          id?: string
          item_key: string
          raid_boss_id?: string | null
          user_id: string
        }
        Update: {
          earned_at?: string
          earned_rank?: string
          id?: string
          item_key?: string
          raid_boss_id?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_raid_rewards_raid_boss_id_fkey"
            columns: ["raid_boss_id"]
            isOneToOne: false
            referencedRelation: "raid_bosses"
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
      user_stamina: {
        Row: {
          bonus_date: string | null
          bonus_stamina: number
          current_stamina: number
          last_recovery_at: string
          max_stamina: number
          updated_at: string
          user_id: string
        }
        Insert: {
          bonus_date?: string | null
          bonus_stamina?: number
          current_stamina?: number
          last_recovery_at?: string
          max_stamina?: number
          updated_at?: string
          user_id: string
        }
        Update: {
          bonus_date?: string | null
          bonus_stamina?: number
          current_stamina?: number
          last_recovery_at?: string
          max_stamina?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      user_titles: {
        Row: {
          id: string
          title_key: string
          unlocked_at: string
          user_id: string
        }
        Insert: {
          id?: string
          title_key: string
          unlocked_at?: string
          user_id: string
        }
        Update: {
          id?: string
          title_key?: string
          unlocked_at?: string
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
      weight_journey_milestones: {
        Row: {
          achieved_at: string
          badge_key: string | null
          coins_awarded: number
          id: string
          journey_id: string
          milestone_kg: number
          milestone_type: string
          user_id: string
        }
        Insert: {
          achieved_at?: string
          badge_key?: string | null
          coins_awarded?: number
          id?: string
          journey_id: string
          milestone_kg: number
          milestone_type: string
          user_id: string
        }
        Update: {
          achieved_at?: string
          badge_key?: string | null
          coins_awarded?: number
          id?: string
          journey_id?: string
          milestone_kg?: number
          milestone_type?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "weight_journey_milestones_journey_id_fkey"
            columns: ["journey_id"]
            isOneToOne: false
            referencedRelation: "weight_journey"
            referencedColumns: ["id"]
          },
        ]
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
      _quest_condition_values: { Args: { _user_id: string }; Returns: Json }
      _workout_max_weight: {
        Args: { _sets: Json; _weight: number }
        Returns: number
      }
      apply_raid_damage: {
        Args: { _damage: number; _user_id: string; _workout_date: string }
        Returns: Json
      }
      apply_raid_damage_unchecked: {
        Args: { _damage: number; _user_id: string; _workout_date: string }
        Returns: Json
      }
      assert_can_act_for: {
        Args: { _target_user_id: string }
        Returns: undefined
      }
      buy_gacha_ticket: {
        Args: { p_quantity?: number; p_user_id: string }
        Returns: Json
      }
      buy_shop_item: {
        Args: { p_item_key: string; p_quantity?: number; p_user_id: string }
        Returns: Json
      }
      buy_stamina: {
        Args: { p_quantity?: number; p_user_id: string }
        Returns: Json
      }
      check_collection_milestones: { Args: { _user_id: string }; Returns: Json }
      check_collection_milestones_unchecked: {
        Args: { _user_id: string }
        Returns: Json
      }
      check_training_milestones: { Args: { p_user_id: string }; Returns: Json }
      check_training_milestones_unchecked: {
        Args: { p_user_id: string }
        Returns: Json
      }
      check_weight_milestones: { Args: { p_user_id: string }; Returns: Json }
      check_weight_milestones_unchecked: {
        Args: { p_user_id: string }
        Returns: Json
      }
      claim_daily_login_bonus: { Args: { p_user_id: string }; Returns: Json }
      claim_my_profile: { Args: never; Returns: boolean }
      claim_rival_reward: { Args: { p_battle_id: string }; Returns: Json }
      complete_dungeon_run: {
        Args: {
          p_dropped_materials?: Json
          p_floors_cleared: number
          p_result: string
          p_run_id: string
          p_total_coins: number
          p_total_exp: number
        }
        Returns: Json
      }
      complete_quest_stage: {
        Args: { p_stage_id: number; p_user_id: string }
        Returns: Json
      }
      complete_quest_stage_unchecked: {
        Args: { p_stage_id: number; p_user_id: string }
        Returns: Json
      }
      complete_rival_battles: { Args: { p_week_start: string }; Returns: Json }
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
      distribute_raid_rewards: {
        Args: { p_raid_boss_id: string }
        Returns: Json
      }
      email_queue_dispatch: { Args: never; Returns: undefined }
      enqueue_email: {
        Args: { payload: Json; queue_name: string }
        Returns: number
      }
      ensure_starter_companion: {
        Args: { p_user_id: string }
        Returns: undefined
      }
      ensure_starter_items: { Args: { p_user_id: string }; Returns: undefined }
      enter_rival_battle: { Args: never; Returns: Json }
      equip_frame: { Args: { p_frame_key: string }; Returns: Json }
      equip_item: {
        Args: { p_item_id: string; p_user_id: string }
        Returns: Json
      }
      equip_item_unchecked: {
        Args: { p_item_id: string; p_user_id: string }
        Returns: Json
      }
      execute_quest_battle: {
        Args: { p_session_volume: number; p_user_id: string }
        Returns: Json
      }
      execute_quest_battle_unchecked: {
        Args: { p_session_volume: number; p_user_id: string }
        Returns: Json
      }
      feed_companion: {
        Args: {
          p_companion_key: string
          p_premium?: boolean
          p_user_id: string
        }
        Returns: Json
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
      get_login_bonus_status: { Args: { p_user_id: string }; Returns: Json }
      get_my_staff_invite_code: { Args: never; Returns: string }
      get_my_tenant_id: { Args: never; Returns: string }
      get_my_tenant_invite_code: { Args: never; Returns: string }
      get_player_combat_stats: { Args: { p_user_id: string }; Returns: Json }
      get_player_combat_stats_unchecked: {
        Args: { p_user_id: string }
        Returns: Json
      }
      get_quest_progress: { Args: { p_user_id: string }; Returns: Json }
      get_quest_progress_unchecked: {
        Args: { p_user_id: string }
        Returns: Json
      }
      get_ranking: { Args: { p_gender: string; p_type: string }; Returns: Json }
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
          slot_duration_minutes: number
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
      grant_companion_exp: {
        Args: { p_exp: number; p_user_id: string }
        Returns: Json
      }
      grant_equipment: {
        Args: { p_item_key: string; p_obtained_via?: string; p_user_id: string }
        Returns: Json
      }
      grant_training_stamina_bonus_for: {
        Args: { p_user_id: string }
        Returns: undefined
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
      hatch_companion_egg: {
        Args: { p_egg_key: string; p_user_id: string }
        Returns: Json
      }
      import_customers: {
        Args: { _rows: Json; _tenant_id: string }
        Returns: number
      }
      initialize_quest_boss_progress: { Args: never; Returns: Json }
      initialize_quest_progress: { Args: never; Returns: Json }
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
      process_session_rewards: {
        Args: { _user_id: string; _workout_date: string }
        Returns: Json
      }
      process_session_rewards_unchecked: {
        Args: { _user_id: string; _workout_date: string }
        Returns: Json
      }
      purchase_customization_item: {
        Args: { p_item_key: string }
        Returns: Json
      }
      read_email_batch: {
        Args: { batch_size: number; queue_name: string; vt: number }
        Returns: {
          message: Json
          msg_id: number
          read_ct: number
        }[]
      }
      recalculate_event_progress: {
        Args: { p_event_id: string }
        Returns: Json
      }
      recover_stamina: { Args: { p_user_id: string }; Returns: Json }
      regenerate_staff_invite_code: { Args: never; Returns: string }
      remove_staff_member: { Args: { p_user_id: string }; Returns: undefined }
      resolve_booking_capacity: {
        Args: { p_booking_date: string; p_tenant_id: string }
        Returns: number
      }
      run_rival_matching: { Args: { p_week_start: string }; Returns: Json }
      set_active_companion: {
        Args: { p_companion_key: string; p_user_id: string }
        Returns: Json
      }
      set_featured_badges: { Args: { p_badges: string[] }; Returns: undefined }
      shares_tenant_with_me: {
        Args: { _target_user_id: string }
        Returns: boolean
      }
      spin_gacha: {
        Args: { _result_date: string; _user_id: string }
        Returns: Json
      }
      spin_gacha_unchecked: {
        Args: { _result_date: string; _user_id: string }
        Returns: Json
      }
      start_dungeon_run: {
        Args: { p_stage_key: string; p_user_id: string }
        Returns: Json
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
      update_event_progress: { Args: { _user_id: string }; Returns: Json }
      update_event_progress_unchecked: {
        Args: { _user_id: string }
        Returns: Json
      }
      update_rival_battle_volumes: {
        Args: { p_week_start: string }
        Returns: Json
      }
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
