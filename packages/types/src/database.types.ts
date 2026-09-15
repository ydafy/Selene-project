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
      addresses: {
        Row: {
          city: string
          country: string
          created_at: string
          deleted_at: string | null
          district: string | null
          full_name: string
          id: string
          instructions: string | null
          is_default: boolean | null
          label: string
          latitude: number | null
          longitude: number | null
          phone: string
          state: string
          street_line1: string
          street_line2: string | null
          street_number: string | null
          user_id: string
          zip_code: string
        }
        Insert: {
          city: string
          country?: string
          created_at?: string
          deleted_at?: string | null
          district?: string | null
          full_name: string
          id?: string
          instructions?: string | null
          is_default?: boolean | null
          label: string
          latitude?: number | null
          longitude?: number | null
          phone: string
          state: string
          street_line1: string
          street_line2?: string | null
          street_number?: string | null
          user_id: string
          zip_code: string
        }
        Update: {
          city?: string
          country?: string
          created_at?: string
          deleted_at?: string | null
          district?: string | null
          full_name?: string
          id?: string
          instructions?: string | null
          is_default?: boolean | null
          label?: string
          latitude?: number | null
          longitude?: number | null
          phone?: string
          state?: string
          street_line1?: string
          street_line2?: string | null
          street_number?: string | null
          user_id?: string
          zip_code?: string
        }
        Relationships: []
      }
      admin_audit_logs: {
        Row: {
          action_type: string
          admin_id: string | null
          created_at: string | null
          details: Json | null
          id: string
          target_id: string | null
        }
        Insert: {
          action_type: string
          admin_id?: string | null
          created_at?: string | null
          details?: Json | null
          id?: string
          target_id?: string | null
        }
        Update: {
          action_type?: string
          admin_id?: string | null
          created_at?: string | null
          details?: Json | null
          id?: string
          target_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "admin_audit_logs_admin_id_fkey"
            columns: ["admin_id"]
            isOneToOne: false
            referencedRelation: "admin_disputes_monitor_view"
            referencedColumns: ["buyer_id"]
          },
          {
            foreignKeyName: "admin_audit_logs_admin_id_fkey"
            columns: ["admin_id"]
            isOneToOne: false
            referencedRelation: "admin_disputes_monitor_view"
            referencedColumns: ["seller_id"]
          },
          {
            foreignKeyName: "admin_audit_logs_admin_id_fkey"
            columns: ["admin_id"]
            isOneToOne: false
            referencedRelation: "admin_seller_onboarding_view"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "admin_audit_logs_admin_id_fkey"
            columns: ["admin_id"]
            isOneToOne: false
            referencedRelation: "admin_user_directory_view"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "admin_audit_logs_admin_id_fkey"
            columns: ["admin_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      admin_user_notes: {
        Row: {
          admin_id: string | null
          content: string
          created_at: string | null
          id: string
          user_id: string | null
        }
        Insert: {
          admin_id?: string | null
          content: string
          created_at?: string | null
          id?: string
          user_id?: string | null
        }
        Update: {
          admin_id?: string | null
          content?: string
          created_at?: string | null
          id?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "admin_user_notes_admin_id_fkey"
            columns: ["admin_id"]
            isOneToOne: false
            referencedRelation: "admin_disputes_monitor_view"
            referencedColumns: ["buyer_id"]
          },
          {
            foreignKeyName: "admin_user_notes_admin_id_fkey"
            columns: ["admin_id"]
            isOneToOne: false
            referencedRelation: "admin_disputes_monitor_view"
            referencedColumns: ["seller_id"]
          },
          {
            foreignKeyName: "admin_user_notes_admin_id_fkey"
            columns: ["admin_id"]
            isOneToOne: false
            referencedRelation: "admin_seller_onboarding_view"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "admin_user_notes_admin_id_fkey"
            columns: ["admin_id"]
            isOneToOne: false
            referencedRelation: "admin_user_directory_view"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "admin_user_notes_admin_id_fkey"
            columns: ["admin_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "admin_user_notes_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "admin_disputes_monitor_view"
            referencedColumns: ["buyer_id"]
          },
          {
            foreignKeyName: "admin_user_notes_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "admin_disputes_monitor_view"
            referencedColumns: ["seller_id"]
          },
          {
            foreignKeyName: "admin_user_notes_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "admin_seller_onboarding_view"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "admin_user_notes_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "admin_user_directory_view"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "admin_user_notes_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      blocked_users: {
        Row: {
          blocked_id: string
          blocker_id: string
          created_at: string
          id: string
        }
        Insert: {
          blocked_id: string
          blocker_id: string
          created_at?: string
          id?: string
        }
        Update: {
          blocked_id?: string
          blocker_id?: string
          created_at?: string
          id?: string
        }
        Relationships: [
          {
            foreignKeyName: "blocked_users_blocked_id_fkey"
            columns: ["blocked_id"]
            isOneToOne: false
            referencedRelation: "admin_disputes_monitor_view"
            referencedColumns: ["buyer_id"]
          },
          {
            foreignKeyName: "blocked_users_blocked_id_fkey"
            columns: ["blocked_id"]
            isOneToOne: false
            referencedRelation: "admin_disputes_monitor_view"
            referencedColumns: ["seller_id"]
          },
          {
            foreignKeyName: "blocked_users_blocked_id_fkey"
            columns: ["blocked_id"]
            isOneToOne: false
            referencedRelation: "admin_seller_onboarding_view"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "blocked_users_blocked_id_fkey"
            columns: ["blocked_id"]
            isOneToOne: false
            referencedRelation: "admin_user_directory_view"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "blocked_users_blocked_id_fkey"
            columns: ["blocked_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "blocked_users_blocker_id_fkey"
            columns: ["blocker_id"]
            isOneToOne: false
            referencedRelation: "admin_disputes_monitor_view"
            referencedColumns: ["buyer_id"]
          },
          {
            foreignKeyName: "blocked_users_blocker_id_fkey"
            columns: ["blocker_id"]
            isOneToOne: false
            referencedRelation: "admin_disputes_monitor_view"
            referencedColumns: ["seller_id"]
          },
          {
            foreignKeyName: "blocked_users_blocker_id_fkey"
            columns: ["blocker_id"]
            isOneToOne: false
            referencedRelation: "admin_seller_onboarding_view"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "blocked_users_blocker_id_fkey"
            columns: ["blocker_id"]
            isOneToOne: false
            referencedRelation: "admin_user_directory_view"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "blocked_users_blocker_id_fkey"
            columns: ["blocker_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      category_configurations: {
        Row: {
          category_name: string
          filter_fields: Json
          sell_fields: Json
          updated_at: string | null
        }
        Insert: {
          category_name: string
          filter_fields: Json
          sell_fields: Json
          updated_at?: string | null
        }
        Update: {
          category_name?: string
          filter_fields?: Json
          sell_fields?: Json
          updated_at?: string | null
        }
        Relationships: []
      }
      checkout_recovery_shells: {
        Row: {
          charged_amount_cents: number | null
          compensation_attempt_count: number
          compensation_last_error: string | null
          compensation_lease_expires_at: string | null
          compensation_state: string
          created_at: string
          next_compensation_retry_at: string | null
          reason: string
          source_metadata: Json
          stripe_charge_id: string | null
          stripe_payment_intent_id: string
          stripe_refund_id: string | null
          updated_at: string
        }
        Insert: {
          charged_amount_cents?: number | null
          compensation_attempt_count?: number
          compensation_last_error?: string | null
          compensation_lease_expires_at?: string | null
          compensation_state?: string
          created_at?: string
          next_compensation_retry_at?: string | null
          reason: string
          source_metadata?: Json
          stripe_charge_id?: string | null
          stripe_payment_intent_id: string
          stripe_refund_id?: string | null
          updated_at?: string
        }
        Update: {
          charged_amount_cents?: number | null
          compensation_attempt_count?: number
          compensation_last_error?: string | null
          compensation_lease_expires_at?: string | null
          compensation_state?: string
          created_at?: string
          next_compensation_retry_at?: string | null
          reason?: string
          source_metadata?: Json
          stripe_charge_id?: string | null
          stripe_payment_intent_id?: string
          stripe_refund_id?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      connect_payout_run_shipments: {
        Row: {
          created_at: string
          id: string
          net_payout: number
          run_id: string
          shipment_id: string
          status: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          net_payout: number
          run_id: string
          shipment_id: string
          status?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          net_payout?: number
          run_id?: string
          shipment_id?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "connect_payout_run_shipments_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "connect_payout_runs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "connect_payout_run_shipments_shipment_id_fkey"
            columns: ["shipment_id"]
            isOneToOne: false
            referencedRelation: "admin_connect_earnings_view"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "connect_payout_run_shipments_shipment_id_fkey"
            columns: ["shipment_id"]
            isOneToOne: false
            referencedRelation: "admin_connect_payout_release_view"
            referencedColumns: ["shipment_id"]
          },
          {
            foreignKeyName: "connect_payout_run_shipments_shipment_id_fkey"
            columns: ["shipment_id"]
            isOneToOne: false
            referencedRelation: "shipments"
            referencedColumns: ["id"]
          },
        ]
      }
      connect_payout_runs: {
        Row: {
          actor_id: string
          amount: number
          created_at: string
          failed_at: string | null
          failure_reason: string | null
          id: string
          idempotency_key: string
          paid_at: string | null
          seller_id: string
          status: string
          stripe_payout_id: string | null
          updated_at: string
        }
        Insert: {
          actor_id: string
          amount: number
          created_at?: string
          failed_at?: string | null
          failure_reason?: string | null
          id?: string
          idempotency_key: string
          paid_at?: string | null
          seller_id: string
          status?: string
          stripe_payout_id?: string | null
          updated_at?: string
        }
        Update: {
          actor_id?: string
          amount?: number
          created_at?: string
          failed_at?: string | null
          failure_reason?: string | null
          id?: string
          idempotency_key?: string
          paid_at?: string | null
          seller_id?: string
          status?: string
          stripe_payout_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "connect_payout_runs_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "admin_disputes_monitor_view"
            referencedColumns: ["buyer_id"]
          },
          {
            foreignKeyName: "connect_payout_runs_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "admin_disputes_monitor_view"
            referencedColumns: ["seller_id"]
          },
          {
            foreignKeyName: "connect_payout_runs_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "admin_seller_onboarding_view"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "connect_payout_runs_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "admin_user_directory_view"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "connect_payout_runs_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "connect_payout_runs_seller_id_fkey"
            columns: ["seller_id"]
            isOneToOne: false
            referencedRelation: "admin_disputes_monitor_view"
            referencedColumns: ["buyer_id"]
          },
          {
            foreignKeyName: "connect_payout_runs_seller_id_fkey"
            columns: ["seller_id"]
            isOneToOne: false
            referencedRelation: "admin_disputes_monitor_view"
            referencedColumns: ["seller_id"]
          },
          {
            foreignKeyName: "connect_payout_runs_seller_id_fkey"
            columns: ["seller_id"]
            isOneToOne: false
            referencedRelation: "admin_seller_onboarding_view"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "connect_payout_runs_seller_id_fkey"
            columns: ["seller_id"]
            isOneToOne: false
            referencedRelation: "admin_user_directory_view"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "connect_payout_runs_seller_id_fkey"
            columns: ["seller_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      disputes: {
        Row: {
          admin_notes: string | null
          buyer_evidence: Json | null
          buyer_id: string
          created_at: string | null
          description: string
          id: string
          locked_at: string | null
          locked_by: string | null
          order_id: string
          reason: Database["public"]["Enums"]["dispute_reason"]
          resolution_type: string | null
          resolved_by: string | null
          return_delivered_at: string | null
          return_label_url: string | null
          return_last_tracked_at: string | null
          return_payout_id: string | null
          return_payout_status: string | null
          return_tracking_number: string | null
          seller_evidence: Json | null
          seller_id: string
          shipment_id: string | null
          status: Database["public"]["Enums"]["dispute_status"] | null
          updated_at: string | null
        }
        Insert: {
          admin_notes?: string | null
          buyer_evidence?: Json | null
          buyer_id: string
          created_at?: string | null
          description: string
          id?: string
          locked_at?: string | null
          locked_by?: string | null
          order_id: string
          reason: Database["public"]["Enums"]["dispute_reason"]
          resolution_type?: string | null
          resolved_by?: string | null
          return_delivered_at?: string | null
          return_label_url?: string | null
          return_last_tracked_at?: string | null
          return_payout_id?: string | null
          return_payout_status?: string | null
          return_tracking_number?: string | null
          seller_evidence?: Json | null
          seller_id: string
          shipment_id?: string | null
          status?: Database["public"]["Enums"]["dispute_status"] | null
          updated_at?: string | null
        }
        Update: {
          admin_notes?: string | null
          buyer_evidence?: Json | null
          buyer_id?: string
          created_at?: string | null
          description?: string
          id?: string
          locked_at?: string | null
          locked_by?: string | null
          order_id?: string
          reason?: Database["public"]["Enums"]["dispute_reason"]
          resolution_type?: string | null
          resolved_by?: string | null
          return_delivered_at?: string | null
          return_label_url?: string | null
          return_last_tracked_at?: string | null
          return_payout_id?: string | null
          return_payout_status?: string | null
          return_tracking_number?: string | null
          seller_evidence?: Json | null
          seller_id?: string
          shipment_id?: string | null
          status?: Database["public"]["Enums"]["dispute_status"] | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "disputes_buyer_id_fkey"
            columns: ["buyer_id"]
            isOneToOne: false
            referencedRelation: "admin_disputes_monitor_view"
            referencedColumns: ["buyer_id"]
          },
          {
            foreignKeyName: "disputes_buyer_id_fkey"
            columns: ["buyer_id"]
            isOneToOne: false
            referencedRelation: "admin_disputes_monitor_view"
            referencedColumns: ["seller_id"]
          },
          {
            foreignKeyName: "disputes_buyer_id_fkey"
            columns: ["buyer_id"]
            isOneToOne: false
            referencedRelation: "admin_seller_onboarding_view"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "disputes_buyer_id_fkey"
            columns: ["buyer_id"]
            isOneToOne: false
            referencedRelation: "admin_user_directory_view"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "disputes_buyer_id_fkey"
            columns: ["buyer_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "disputes_locked_by_fkey"
            columns: ["locked_by"]
            isOneToOne: false
            referencedRelation: "admin_disputes_monitor_view"
            referencedColumns: ["buyer_id"]
          },
          {
            foreignKeyName: "disputes_locked_by_fkey"
            columns: ["locked_by"]
            isOneToOne: false
            referencedRelation: "admin_disputes_monitor_view"
            referencedColumns: ["seller_id"]
          },
          {
            foreignKeyName: "disputes_locked_by_fkey"
            columns: ["locked_by"]
            isOneToOne: false
            referencedRelation: "admin_seller_onboarding_view"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "disputes_locked_by_fkey"
            columns: ["locked_by"]
            isOneToOne: false
            referencedRelation: "admin_user_directory_view"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "disputes_locked_by_fkey"
            columns: ["locked_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "disputes_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "admin_disputes_monitor_view"
            referencedColumns: ["order_id"]
          },
          {
            foreignKeyName: "disputes_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "disputes_resolved_by_fkey"
            columns: ["resolved_by"]
            isOneToOne: false
            referencedRelation: "admin_disputes_monitor_view"
            referencedColumns: ["buyer_id"]
          },
          {
            foreignKeyName: "disputes_resolved_by_fkey"
            columns: ["resolved_by"]
            isOneToOne: false
            referencedRelation: "admin_disputes_monitor_view"
            referencedColumns: ["seller_id"]
          },
          {
            foreignKeyName: "disputes_resolved_by_fkey"
            columns: ["resolved_by"]
            isOneToOne: false
            referencedRelation: "admin_seller_onboarding_view"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "disputes_resolved_by_fkey"
            columns: ["resolved_by"]
            isOneToOne: false
            referencedRelation: "admin_user_directory_view"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "disputes_resolved_by_fkey"
            columns: ["resolved_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "disputes_seller_id_fkey"
            columns: ["seller_id"]
            isOneToOne: false
            referencedRelation: "admin_disputes_monitor_view"
            referencedColumns: ["buyer_id"]
          },
          {
            foreignKeyName: "disputes_seller_id_fkey"
            columns: ["seller_id"]
            isOneToOne: false
            referencedRelation: "admin_disputes_monitor_view"
            referencedColumns: ["seller_id"]
          },
          {
            foreignKeyName: "disputes_seller_id_fkey"
            columns: ["seller_id"]
            isOneToOne: false
            referencedRelation: "admin_seller_onboarding_view"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "disputes_seller_id_fkey"
            columns: ["seller_id"]
            isOneToOne: false
            referencedRelation: "admin_user_directory_view"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "disputes_seller_id_fkey"
            columns: ["seller_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "disputes_shipment_id_fkey"
            columns: ["shipment_id"]
            isOneToOne: true
            referencedRelation: "admin_connect_earnings_view"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "disputes_shipment_id_fkey"
            columns: ["shipment_id"]
            isOneToOne: true
            referencedRelation: "admin_connect_payout_release_view"
            referencedColumns: ["shipment_id"]
          },
          {
            foreignKeyName: "disputes_shipment_id_fkey"
            columns: ["shipment_id"]
            isOneToOne: true
            referencedRelation: "shipments"
            referencedColumns: ["id"]
          },
        ]
      }
      favorites: {
        Row: {
          created_at: string
          id: string
          product_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          product_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          product_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "favorites_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "admin_product_queue_view"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "favorites_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "favorites_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "admin_disputes_monitor_view"
            referencedColumns: ["buyer_id"]
          },
          {
            foreignKeyName: "favorites_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "admin_disputes_monitor_view"
            referencedColumns: ["seller_id"]
          },
          {
            foreignKeyName: "favorites_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "admin_seller_onboarding_view"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "favorites_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "admin_user_directory_view"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "favorites_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      mexico_banks: {
        Row: {
          active: boolean | null
          code: string
          name: string
        }
        Insert: {
          active?: boolean | null
          code: string
          name: string
        }
        Update: {
          active?: boolean | null
          code?: string
          name?: string
        }
        Relationships: []
      }
      mexico_zips: {
        Row: {
          city: string | null
          district: string | null
          id: number
          state_code: string | null
          state_name: string | null
          zip_code: string | null
        }
        Insert: {
          city?: string | null
          district?: string | null
          id?: number
          state_code?: string | null
          state_name?: string | null
          zip_code?: string | null
        }
        Update: {
          city?: string | null
          district?: string | null
          id?: number
          state_code?: string | null
          state_name?: string | null
          zip_code?: string | null
        }
        Relationships: []
      }
      notifications: {
        Row: {
          action_path: string | null
          created_at: string
          deleted_at: string | null
          id: string
          message: string | null
          read: boolean | null
          title: string
          type: string | null
          user_id: string
        }
        Insert: {
          action_path?: string | null
          created_at?: string
          deleted_at?: string | null
          id?: string
          message?: string | null
          read?: boolean | null
          title: string
          type?: string | null
          user_id: string
        }
        Update: {
          action_path?: string | null
          created_at?: string
          deleted_at?: string | null
          id?: string
          message?: string | null
          read?: boolean | null
          title?: string
          type?: string | null
          user_id?: string
        }
        Relationships: []
      }
      order_items: {
        Row: {
          commission_amount: number | null
          created_at: string | null
          id: string
          insurance_amount: number | null
          net_payout: number | null
          order_id: string
          price_at_purchase: number
          product_id: string
          sat_tax_withholding: number | null
          seller_id: string
          shipment_id: string | null
          shipping_amount: number | null
          shipping_payer: string | null
        }
        Insert: {
          commission_amount?: number | null
          created_at?: string | null
          id?: string
          insurance_amount?: number | null
          net_payout?: number | null
          order_id: string
          price_at_purchase: number
          product_id: string
          sat_tax_withholding?: number | null
          seller_id: string
          shipment_id?: string | null
          shipping_amount?: number | null
          shipping_payer?: string | null
        }
        Update: {
          commission_amount?: number | null
          created_at?: string | null
          id?: string
          insurance_amount?: number | null
          net_payout?: number | null
          order_id?: string
          price_at_purchase?: number
          product_id?: string
          sat_tax_withholding?: number | null
          seller_id?: string
          shipment_id?: string | null
          shipping_amount?: number | null
          shipping_payer?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "order_items_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "admin_disputes_monitor_view"
            referencedColumns: ["order_id"]
          },
          {
            foreignKeyName: "order_items_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "admin_product_queue_view"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_items_shipment_id_fkey"
            columns: ["shipment_id"]
            isOneToOne: false
            referencedRelation: "admin_connect_earnings_view"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_items_shipment_id_fkey"
            columns: ["shipment_id"]
            isOneToOne: false
            referencedRelation: "admin_connect_payout_release_view"
            referencedColumns: ["shipment_id"]
          },
          {
            foreignKeyName: "order_items_shipment_id_fkey"
            columns: ["shipment_id"]
            isOneToOne: false
            referencedRelation: "shipments"
            referencedColumns: ["id"]
          },
        ]
      }
      orders: {
        Row: {
          actual_stripe_fee_cents: number | null
          buyer_id: string
          cancellation_loss_cents: number | null
          compensation_attempt_count: number
          compensation_last_error: string | null
          compensation_lease_expires_at: string | null
          compensation_state: string | null
          completed_at: string | null
          created_at: string | null
          currency: string | null
          delivered_at: string | null
          id: string
          next_compensation_retry_at: string | null
          payment_processing: boolean
          payment_processing_reason: string | null
          service_fee_amount: number | null
          shipping_address: Json
          status: Database["public"]["Enums"]["order_status_enum"]
          stripe_charge_id: string | null
          stripe_fee_reconciled_at: string | null
          stripe_payment_intent_id: string | null
          stripe_refund_id: string | null
          stripe_transfer_group: string | null
          total_amount: number
          updated_at: string | null
        }
        Insert: {
          actual_stripe_fee_cents?: number | null
          buyer_id: string
          cancellation_loss_cents?: number | null
          compensation_attempt_count?: number
          compensation_last_error?: string | null
          compensation_lease_expires_at?: string | null
          compensation_state?: string | null
          completed_at?: string | null
          created_at?: string | null
          currency?: string | null
          delivered_at?: string | null
          id?: string
          next_compensation_retry_at?: string | null
          payment_processing?: boolean
          payment_processing_reason?: string | null
          service_fee_amount?: number | null
          shipping_address: Json
          status?: Database["public"]["Enums"]["order_status_enum"]
          stripe_charge_id?: string | null
          stripe_fee_reconciled_at?: string | null
          stripe_payment_intent_id?: string | null
          stripe_refund_id?: string | null
          stripe_transfer_group?: string | null
          total_amount: number
          updated_at?: string | null
        }
        Update: {
          actual_stripe_fee_cents?: number | null
          buyer_id?: string
          cancellation_loss_cents?: number | null
          compensation_attempt_count?: number
          compensation_last_error?: string | null
          compensation_lease_expires_at?: string | null
          compensation_state?: string | null
          completed_at?: string | null
          created_at?: string | null
          currency?: string | null
          delivered_at?: string | null
          id?: string
          next_compensation_retry_at?: string | null
          payment_processing?: boolean
          payment_processing_reason?: string | null
          service_fee_amount?: number | null
          shipping_address?: Json
          status?: Database["public"]["Enums"]["order_status_enum"]
          stripe_charge_id?: string | null
          stripe_fee_reconciled_at?: string | null
          stripe_payment_intent_id?: string | null
          stripe_refund_id?: string | null
          stripe_transfer_group?: string | null
          total_amount?: number
          updated_at?: string | null
        }
        Relationships: []
      }
      payment_methods: {
        Row: {
          brand: string
          created_at: string
          deleted_at: string | null
          exp_month: number
          exp_year: number
          id: string
          is_default: boolean | null
          last4: string
          stripe_payment_method_id: string
          user_id: string
        }
        Insert: {
          brand: string
          created_at?: string
          deleted_at?: string | null
          exp_month: number
          exp_year: number
          id?: string
          is_default?: boolean | null
          last4: string
          stripe_payment_method_id: string
          user_id: string
        }
        Update: {
          brand?: string
          created_at?: string
          deleted_at?: string | null
          exp_month?: number
          exp_year?: number
          id?: string
          is_default?: boolean | null
          last4?: string
          stripe_payment_method_id?: string
          user_id?: string
        }
        Relationships: []
      }
      payout_requests: {
        Row: {
          amount: number
          bank_account_id: string
          completed_at: string | null
          id: string
          notes: string | null
          processed_at: string | null
          processed_by: string | null
          rejected_at: string | null
          rejected_reason: string | null
          requested_at: string | null
          status: Database["public"]["Enums"]["payout_status"] | null
          user_id: string
          wallet_id: string
        }
        Insert: {
          amount: number
          bank_account_id: string
          completed_at?: string | null
          id?: string
          notes?: string | null
          processed_at?: string | null
          processed_by?: string | null
          rejected_at?: string | null
          rejected_reason?: string | null
          requested_at?: string | null
          status?: Database["public"]["Enums"]["payout_status"] | null
          user_id: string
          wallet_id: string
        }
        Update: {
          amount?: number
          bank_account_id?: string
          completed_at?: string | null
          id?: string
          notes?: string | null
          processed_at?: string | null
          processed_by?: string | null
          rejected_at?: string | null
          rejected_reason?: string | null
          requested_at?: string | null
          status?: Database["public"]["Enums"]["payout_status"] | null
          user_id?: string
          wallet_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "payout_requests_bank_account_id_fkey"
            columns: ["bank_account_id"]
            isOneToOne: false
            referencedRelation: "seller_bank_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payout_requests_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "admin_disputes_monitor_view"
            referencedColumns: ["buyer_id"]
          },
          {
            foreignKeyName: "payout_requests_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "admin_disputes_monitor_view"
            referencedColumns: ["seller_id"]
          },
          {
            foreignKeyName: "payout_requests_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "admin_seller_onboarding_view"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payout_requests_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "admin_user_directory_view"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payout_requests_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payout_requests_wallet_id_fkey"
            columns: ["wallet_id"]
            isOneToOne: false
            referencedRelation: "wallets"
            referencedColumns: ["id"]
          },
        ]
      }
      products: {
        Row: {
          aspect_ratio: number
          category: string
          condition: string
          created_at: string
          deleted_at: string | null
          description: string
          fts: unknown
          id: string
          images: string[]
          locked_at: string | null
          locked_by: string | null
          name: string
          origin_zip: string | null
          package_preset: string | null
          price: number
          publication_commission_rate: number | null
          publication_insurance_rate: number | null
          publication_shipping_reserve_cents: number | null
          rejection_reason: string | null
          reserved_at: string | null
          seller_id: string
          shipping_cost: number | null
          shipping_payer: string | null
          specifications: Json
          status: Database["public"]["Enums"]["product_status_enum"]
          updated_at: string | null
          usage: string
          verification_data: Json | null
          verified_at: string | null
          views: number
        }
        Insert: {
          aspect_ratio?: number
          category: string
          condition: string
          created_at?: string
          deleted_at?: string | null
          description: string
          fts?: unknown
          id?: string
          images?: string[]
          locked_at?: string | null
          locked_by?: string | null
          name: string
          origin_zip?: string | null
          package_preset?: string | null
          price: number
          publication_commission_rate?: number | null
          publication_insurance_rate?: number | null
          publication_shipping_reserve_cents?: number | null
          rejection_reason?: string | null
          reserved_at?: string | null
          seller_id: string
          shipping_cost?: number | null
          shipping_payer?: string | null
          specifications?: Json
          status?: Database["public"]["Enums"]["product_status_enum"]
          updated_at?: string | null
          usage: string
          verification_data?: Json | null
          verified_at?: string | null
          views?: number
        }
        Update: {
          aspect_ratio?: number
          category?: string
          condition?: string
          created_at?: string
          deleted_at?: string | null
          description?: string
          fts?: unknown
          id?: string
          images?: string[]
          locked_at?: string | null
          locked_by?: string | null
          name?: string
          origin_zip?: string | null
          package_preset?: string | null
          price?: number
          publication_commission_rate?: number | null
          publication_insurance_rate?: number | null
          publication_shipping_reserve_cents?: number | null
          rejection_reason?: string | null
          reserved_at?: string | null
          seller_id?: string
          shipping_cost?: number | null
          shipping_payer?: string | null
          specifications?: Json
          status?: Database["public"]["Enums"]["product_status_enum"]
          updated_at?: string | null
          usage?: string
          verification_data?: Json | null
          verified_at?: string | null
          views?: number
        }
        Relationships: [
          {
            foreignKeyName: "products_locked_by_fkey"
            columns: ["locked_by"]
            isOneToOne: false
            referencedRelation: "admin_disputes_monitor_view"
            referencedColumns: ["buyer_id"]
          },
          {
            foreignKeyName: "products_locked_by_fkey"
            columns: ["locked_by"]
            isOneToOne: false
            referencedRelation: "admin_disputes_monitor_view"
            referencedColumns: ["seller_id"]
          },
          {
            foreignKeyName: "products_locked_by_fkey"
            columns: ["locked_by"]
            isOneToOne: false
            referencedRelation: "admin_seller_onboarding_view"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "products_locked_by_fkey"
            columns: ["locked_by"]
            isOneToOne: false
            referencedRelation: "admin_user_directory_view"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "products_locked_by_fkey"
            columns: ["locked_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "products_seller_id_fkey"
            columns: ["seller_id"]
            isOneToOne: false
            referencedRelation: "admin_disputes_monitor_view"
            referencedColumns: ["buyer_id"]
          },
          {
            foreignKeyName: "products_seller_id_fkey"
            columns: ["seller_id"]
            isOneToOne: false
            referencedRelation: "admin_disputes_monitor_view"
            referencedColumns: ["seller_id"]
          },
          {
            foreignKeyName: "products_seller_id_fkey"
            columns: ["seller_id"]
            isOneToOne: false
            referencedRelation: "admin_seller_onboarding_view"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "products_seller_id_fkey"
            columns: ["seller_id"]
            isOneToOne: false
            referencedRelation: "admin_user_directory_view"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "products_seller_id_fkey"
            columns: ["seller_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          avatar_url: string | null
          average_rating: number
          created_at: string
          id: string
          is_verified_seller: boolean | null
          total_reviews: number
          total_sales: number
          updated_at: string | null
          username: string | null
        }
        Insert: {
          avatar_url?: string | null
          average_rating?: number
          created_at?: string
          id: string
          is_verified_seller?: boolean | null
          total_reviews?: number
          total_sales?: number
          updated_at?: string | null
          username?: string | null
        }
        Update: {
          avatar_url?: string | null
          average_rating?: number
          created_at?: string
          id?: string
          is_verified_seller?: boolean | null
          total_reviews?: number
          total_sales?: number
          updated_at?: string | null
          username?: string | null
        }
        Relationships: []
      }
      profiles_private: {
        Row: {
          email: string | null
          id: string
          last_sign_in_at: string | null
          phone_number: string | null
          role: string | null
          status: Database["public"]["Enums"]["account_status"] | null
          status_reason: string | null
          status_updated_at: string | null
          status_updated_by: string | null
          stripe_account_id: string | null
          stripe_customer_id: string | null
          stripe_onboarding_refreshed_at: string | null
          stripe_onboarding_status:
            | Database["public"]["Enums"]["stripe_onboarding_status"]
            | null
          updated_at: string | null
        }
        Insert: {
          email?: string | null
          id: string
          last_sign_in_at?: string | null
          phone_number?: string | null
          role?: string | null
          status?: Database["public"]["Enums"]["account_status"] | null
          status_reason?: string | null
          status_updated_at?: string | null
          status_updated_by?: string | null
          stripe_account_id?: string | null
          stripe_customer_id?: string | null
          stripe_onboarding_refreshed_at?: string | null
          stripe_onboarding_status?:
            | Database["public"]["Enums"]["stripe_onboarding_status"]
            | null
          updated_at?: string | null
        }
        Update: {
          email?: string | null
          id?: string
          last_sign_in_at?: string | null
          phone_number?: string | null
          role?: string | null
          status?: Database["public"]["Enums"]["account_status"] | null
          status_reason?: string | null
          status_updated_at?: string | null
          status_updated_by?: string | null
          stripe_account_id?: string | null
          stripe_customer_id?: string | null
          stripe_onboarding_refreshed_at?: string | null
          stripe_onboarding_status?:
            | Database["public"]["Enums"]["stripe_onboarding_status"]
            | null
          updated_at?: string | null
        }
        Relationships: []
      }
      reports: {
        Row: {
          created_at: string
          id: string
          reason: string | null
          reporter_id: string
          status: string
          target_id: string
          target_type: string
        }
        Insert: {
          created_at?: string
          id?: string
          reason?: string | null
          reporter_id: string
          status?: string
          target_id: string
          target_type: string
        }
        Update: {
          created_at?: string
          id?: string
          reason?: string | null
          reporter_id?: string
          status?: string
          target_id?: string
          target_type?: string
        }
        Relationships: [
          {
            foreignKeyName: "reports_reporter_id_fkey"
            columns: ["reporter_id"]
            isOneToOne: false
            referencedRelation: "admin_disputes_monitor_view"
            referencedColumns: ["buyer_id"]
          },
          {
            foreignKeyName: "reports_reporter_id_fkey"
            columns: ["reporter_id"]
            isOneToOne: false
            referencedRelation: "admin_disputes_monitor_view"
            referencedColumns: ["seller_id"]
          },
          {
            foreignKeyName: "reports_reporter_id_fkey"
            columns: ["reporter_id"]
            isOneToOne: false
            referencedRelation: "admin_seller_onboarding_view"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reports_reporter_id_fkey"
            columns: ["reporter_id"]
            isOneToOne: false
            referencedRelation: "admin_user_directory_view"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reports_reporter_id_fkey"
            columns: ["reporter_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      reviews: {
        Row: {
          comment: string | null
          created_at: string
          id: string
          order_id: string | null
          product_id: string | null
          rating: number
          reviewer_id: string
          seller_id: string
          shipment_id: string | null
        }
        Insert: {
          comment?: string | null
          created_at?: string
          id?: string
          order_id?: string | null
          product_id?: string | null
          rating: number
          reviewer_id: string
          seller_id: string
          shipment_id?: string | null
        }
        Update: {
          comment?: string | null
          created_at?: string
          id?: string
          order_id?: string | null
          product_id?: string | null
          rating?: number
          reviewer_id?: string
          seller_id?: string
          shipment_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "reviews_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "admin_disputes_monitor_view"
            referencedColumns: ["order_id"]
          },
          {
            foreignKeyName: "reviews_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reviews_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "admin_product_queue_view"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reviews_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reviews_reviewer_id_fkey"
            columns: ["reviewer_id"]
            isOneToOne: false
            referencedRelation: "admin_disputes_monitor_view"
            referencedColumns: ["buyer_id"]
          },
          {
            foreignKeyName: "reviews_reviewer_id_fkey"
            columns: ["reviewer_id"]
            isOneToOne: false
            referencedRelation: "admin_disputes_monitor_view"
            referencedColumns: ["seller_id"]
          },
          {
            foreignKeyName: "reviews_reviewer_id_fkey"
            columns: ["reviewer_id"]
            isOneToOne: false
            referencedRelation: "admin_seller_onboarding_view"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reviews_reviewer_id_fkey"
            columns: ["reviewer_id"]
            isOneToOne: false
            referencedRelation: "admin_user_directory_view"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reviews_reviewer_id_fkey"
            columns: ["reviewer_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reviews_seller_id_fkey"
            columns: ["seller_id"]
            isOneToOne: false
            referencedRelation: "admin_disputes_monitor_view"
            referencedColumns: ["buyer_id"]
          },
          {
            foreignKeyName: "reviews_seller_id_fkey"
            columns: ["seller_id"]
            isOneToOne: false
            referencedRelation: "admin_disputes_monitor_view"
            referencedColumns: ["seller_id"]
          },
          {
            foreignKeyName: "reviews_seller_id_fkey"
            columns: ["seller_id"]
            isOneToOne: false
            referencedRelation: "admin_seller_onboarding_view"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reviews_seller_id_fkey"
            columns: ["seller_id"]
            isOneToOne: false
            referencedRelation: "admin_user_directory_view"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reviews_seller_id_fkey"
            columns: ["seller_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reviews_shipment_id_fkey"
            columns: ["shipment_id"]
            isOneToOne: false
            referencedRelation: "admin_connect_earnings_view"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reviews_shipment_id_fkey"
            columns: ["shipment_id"]
            isOneToOne: false
            referencedRelation: "admin_connect_payout_release_view"
            referencedColumns: ["shipment_id"]
          },
          {
            foreignKeyName: "reviews_shipment_id_fkey"
            columns: ["shipment_id"]
            isOneToOne: false
            referencedRelation: "shipments"
            referencedColumns: ["id"]
          },
        ]
      }
      seller_bank_accounts: {
        Row: {
          account_holder_name: string
          bank_name: string | null
          clabe: string
          created_at: string | null
          deleted_at: string | null
          id: string
          is_verified: boolean | null
          user_id: string
        }
        Insert: {
          account_holder_name: string
          bank_name?: string | null
          clabe: string
          created_at?: string | null
          deleted_at?: string | null
          id?: string
          is_verified?: boolean | null
          user_id: string
        }
        Update: {
          account_holder_name?: string
          bank_name?: string | null
          clabe?: string
          created_at?: string | null
          deleted_at?: string | null
          id?: string
          is_verified?: boolean | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "seller_bank_accounts_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "admin_disputes_monitor_view"
            referencedColumns: ["buyer_id"]
          },
          {
            foreignKeyName: "seller_bank_accounts_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "admin_disputes_monitor_view"
            referencedColumns: ["seller_id"]
          },
          {
            foreignKeyName: "seller_bank_accounts_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "admin_seller_onboarding_view"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "seller_bank_accounts_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "admin_user_directory_view"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "seller_bank_accounts_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      shipment_completion_events: {
        Row: {
          actor_id: string | null
          completed_at: string
          created_at: string
          id: string
          idempotency_key: string
          is_connect: boolean
          order_id: string
          shipment_id: string
          source: string
        }
        Insert: {
          actor_id?: string | null
          completed_at?: string
          created_at?: string
          id?: string
          idempotency_key: string
          is_connect: boolean
          order_id: string
          shipment_id: string
          source: string
        }
        Update: {
          actor_id?: string | null
          completed_at?: string
          created_at?: string
          id?: string
          idempotency_key?: string
          is_connect?: boolean
          order_id?: string
          shipment_id?: string
          source?: string
        }
        Relationships: [
          {
            foreignKeyName: "shipment_completion_events_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "admin_disputes_monitor_view"
            referencedColumns: ["buyer_id"]
          },
          {
            foreignKeyName: "shipment_completion_events_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "admin_disputes_monitor_view"
            referencedColumns: ["seller_id"]
          },
          {
            foreignKeyName: "shipment_completion_events_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "admin_seller_onboarding_view"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shipment_completion_events_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "admin_user_directory_view"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shipment_completion_events_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shipment_completion_events_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "admin_disputes_monitor_view"
            referencedColumns: ["order_id"]
          },
          {
            foreignKeyName: "shipment_completion_events_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shipment_completion_events_shipment_id_fkey"
            columns: ["shipment_id"]
            isOneToOne: true
            referencedRelation: "admin_connect_earnings_view"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shipment_completion_events_shipment_id_fkey"
            columns: ["shipment_id"]
            isOneToOne: true
            referencedRelation: "admin_connect_payout_release_view"
            referencedColumns: ["shipment_id"]
          },
          {
            foreignKeyName: "shipment_completion_events_shipment_id_fkey"
            columns: ["shipment_id"]
            isOneToOne: true
            referencedRelation: "shipments"
            referencedColumns: ["id"]
          },
        ]
      }
      shipment_label_events: {
        Row: {
          actor_id: string | null
          created_at: string
          event_type: string
          id: string
          metadata: Json
          shipment_id: string
        }
        Insert: {
          actor_id?: string | null
          created_at?: string
          event_type: string
          id?: string
          metadata?: Json
          shipment_id: string
        }
        Update: {
          actor_id?: string | null
          created_at?: string
          event_type?: string
          id?: string
          metadata?: Json
          shipment_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "shipment_label_events_shipment_id_fkey"
            columns: ["shipment_id"]
            isOneToOne: false
            referencedRelation: "admin_connect_earnings_view"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shipment_label_events_shipment_id_fkey"
            columns: ["shipment_id"]
            isOneToOne: false
            referencedRelation: "admin_connect_payout_release_view"
            referencedColumns: ["shipment_id"]
          },
          {
            foreignKeyName: "shipment_label_events_shipment_id_fkey"
            columns: ["shipment_id"]
            isOneToOne: false
            referencedRelation: "shipments"
            referencedColumns: ["id"]
          },
        ]
      }
      shipment_tracking_events: {
        Row: {
          carrier_name: string | null
          dispute_id: string | null
          event_at: string
          event_type: Database["public"]["Enums"]["shipment_tracking_event_type"]
          id: string
          location: string | null
          polling_run_id: string | null
          raw_status: string
          received_at: string
          shipment_id: string
          status_description: string | null
          webhook_delivery_id: string | null
        }
        Insert: {
          carrier_name?: string | null
          dispute_id?: string | null
          event_at: string
          event_type: Database["public"]["Enums"]["shipment_tracking_event_type"]
          id?: string
          location?: string | null
          polling_run_id?: string | null
          raw_status: string
          received_at?: string
          shipment_id: string
          status_description?: string | null
          webhook_delivery_id?: string | null
        }
        Update: {
          carrier_name?: string | null
          dispute_id?: string | null
          event_at?: string
          event_type?: Database["public"]["Enums"]["shipment_tracking_event_type"]
          id?: string
          location?: string | null
          polling_run_id?: string | null
          raw_status?: string
          received_at?: string
          shipment_id?: string
          status_description?: string | null
          webhook_delivery_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "shipment_tracking_events_dispute_id_fkey"
            columns: ["dispute_id"]
            isOneToOne: false
            referencedRelation: "admin_disputes_monitor_view"
            referencedColumns: ["dispute_id"]
          },
          {
            foreignKeyName: "shipment_tracking_events_dispute_id_fkey"
            columns: ["dispute_id"]
            isOneToOne: false
            referencedRelation: "disputes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shipment_tracking_events_shipment_id_fkey"
            columns: ["shipment_id"]
            isOneToOne: false
            referencedRelation: "admin_connect_earnings_view"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shipment_tracking_events_shipment_id_fkey"
            columns: ["shipment_id"]
            isOneToOne: false
            referencedRelation: "admin_connect_payout_release_view"
            referencedColumns: ["shipment_id"]
          },
          {
            foreignKeyName: "shipment_tracking_events_shipment_id_fkey"
            columns: ["shipment_id"]
            isOneToOne: false
            referencedRelation: "shipments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shipment_tracking_events_webhook_delivery_id_fkey"
            columns: ["webhook_delivery_id"]
            isOneToOne: false
            referencedRelation: "webhook_deliveries"
            referencedColumns: ["id"]
          },
        ]
      }
      shipments: {
        Row: {
          buyer_confirmed_at: string | null
          carrier: string | null
          claim_expires_at: string | null
          claim_token: string | null
          completed_at: string | null
          created_at: string | null
          delivered_at: string | null
          envia_shipment_id: string | null
          id: string
          label_generated_at: string | null
          label_generation_state: string
          label_provider_cost_cents: number | null
          label_quote_carrier: string | null
          label_quote_cost_cents: number | null
          label_quote_input_hash: string | null
          label_quote_rated_at: string | null
          label_quote_reference: string | null
          label_quote_service: string | null
          label_url: string | null
          last_tracked_at: string | null
          order_id: string
          origin_address: Json | null
          origin_address_id: string | null
          print_format: string | null
          print_size: string | null
          return_label_url: string | null
          return_tracking_number: string | null
          seller_id: string
          service: string | null
          shipped_at: string | null
          shipping_cost: number | null
          shipping_evidence: Json | null
          status: Database["public"]["Enums"]["order_status_enum"]
          stripe_payment_intent_id: string | null
          stripe_payout_id: string | null
          stripe_transfer_id: string | null
          tracking_number: string | null
          updated_at: string | null
        }
        Insert: {
          buyer_confirmed_at?: string | null
          carrier?: string | null
          claim_expires_at?: string | null
          claim_token?: string | null
          completed_at?: string | null
          created_at?: string | null
          delivered_at?: string | null
          envia_shipment_id?: string | null
          id?: string
          label_generated_at?: string | null
          label_generation_state?: string
          label_provider_cost_cents?: number | null
          label_quote_carrier?: string | null
          label_quote_cost_cents?: number | null
          label_quote_input_hash?: string | null
          label_quote_rated_at?: string | null
          label_quote_reference?: string | null
          label_quote_service?: string | null
          label_url?: string | null
          last_tracked_at?: string | null
          order_id: string
          origin_address?: Json | null
          origin_address_id?: string | null
          print_format?: string | null
          print_size?: string | null
          return_label_url?: string | null
          return_tracking_number?: string | null
          seller_id: string
          service?: string | null
          shipped_at?: string | null
          shipping_cost?: number | null
          shipping_evidence?: Json | null
          status?: Database["public"]["Enums"]["order_status_enum"]
          stripe_payment_intent_id?: string | null
          stripe_payout_id?: string | null
          stripe_transfer_id?: string | null
          tracking_number?: string | null
          updated_at?: string | null
        }
        Update: {
          buyer_confirmed_at?: string | null
          carrier?: string | null
          claim_expires_at?: string | null
          claim_token?: string | null
          completed_at?: string | null
          created_at?: string | null
          delivered_at?: string | null
          envia_shipment_id?: string | null
          id?: string
          label_generated_at?: string | null
          label_generation_state?: string
          label_provider_cost_cents?: number | null
          label_quote_carrier?: string | null
          label_quote_cost_cents?: number | null
          label_quote_input_hash?: string | null
          label_quote_rated_at?: string | null
          label_quote_reference?: string | null
          label_quote_service?: string | null
          label_url?: string | null
          last_tracked_at?: string | null
          order_id?: string
          origin_address?: Json | null
          origin_address_id?: string | null
          print_format?: string | null
          print_size?: string | null
          return_label_url?: string | null
          return_tracking_number?: string | null
          seller_id?: string
          service?: string | null
          shipped_at?: string | null
          shipping_cost?: number | null
          shipping_evidence?: Json | null
          status?: Database["public"]["Enums"]["order_status_enum"]
          stripe_payment_intent_id?: string | null
          stripe_payout_id?: string | null
          stripe_transfer_id?: string | null
          tracking_number?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "shipments_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "admin_disputes_monitor_view"
            referencedColumns: ["order_id"]
          },
          {
            foreignKeyName: "shipments_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shipments_origin_address_id_fkey"
            columns: ["origin_address_id"]
            isOneToOne: false
            referencedRelation: "addresses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shipments_seller_id_fkey"
            columns: ["seller_id"]
            isOneToOne: false
            referencedRelation: "admin_disputes_monitor_view"
            referencedColumns: ["buyer_id"]
          },
          {
            foreignKeyName: "shipments_seller_id_fkey"
            columns: ["seller_id"]
            isOneToOne: false
            referencedRelation: "admin_disputes_monitor_view"
            referencedColumns: ["seller_id"]
          },
          {
            foreignKeyName: "shipments_seller_id_fkey"
            columns: ["seller_id"]
            isOneToOne: false
            referencedRelation: "admin_seller_onboarding_view"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shipments_seller_id_fkey"
            columns: ["seller_id"]
            isOneToOne: false
            referencedRelation: "admin_user_directory_view"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shipments_seller_id_fkey"
            columns: ["seller_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      system_logs: {
        Row: {
          created_at: string | null
          id: string
          level: string | null
          message: string
          metadata: Json | null
          stack_trace: string | null
          user_id: string | null
        }
        Insert: {
          created_at?: string | null
          id?: string
          level?: string | null
          message: string
          metadata?: Json | null
          stack_trace?: string | null
          user_id?: string | null
        }
        Update: {
          created_at?: string | null
          id?: string
          level?: string | null
          message?: string
          metadata?: Json | null
          stack_trace?: string | null
          user_id?: string | null
        }
        Relationships: []
      }
      system_settings: {
        Row: {
          auto_cancel_orders_running: boolean | null
          auto_cancel_preparing_running: boolean | null
          checkout_recovery_enabled: boolean
          checkout_recovery_running: boolean
          connect_enabled: boolean | null
          currency: string | null
          envia_carrier: string | null
          envia_print_format: string | null
          envia_print_size: string | null
          envia_service: string | null
          id: number
          insurance_rate: number | null
          is_maintenance: boolean | null
          isr_withholding_pct: number | null
          iva_withholding_pct: number | null
          listing_quote_reference_destination: Json | null
          min_payout_amount_cents: number | null
          min_version_android: string | null
          min_version_ios: string | null
          novice_active_limit: number | null
          novice_completed_threshold: number | null
          order_expiration_hours: number | null
          package_presets: Json | null
          payout_fee_fixed_cents: number | null
          preparing_expiration_hours: number | null
          release_funds_running: boolean | null
          return_delivery_timeout_running: boolean | null
          return_label_fee_cents: number | null
          service_fee_fixed_cents: number | null
          service_fee_pct: number | null
          shipping_buffer_cents: number | null
          track_shipments_preparing_lease_expires_at: string | null
          track_shipments_preparing_lease_id: string | null
          track_shipments_shipped_lease_expires_at: string | null
          track_shipments_shipped_lease_id: string | null
          trusted_active_limit: number | null
          updated_at: string | null
        }
        Insert: {
          auto_cancel_orders_running?: boolean | null
          auto_cancel_preparing_running?: boolean | null
          checkout_recovery_enabled?: boolean
          checkout_recovery_running?: boolean
          connect_enabled?: boolean | null
          currency?: string | null
          envia_carrier?: string | null
          envia_print_format?: string | null
          envia_print_size?: string | null
          envia_service?: string | null
          id: number
          insurance_rate?: number | null
          is_maintenance?: boolean | null
          isr_withholding_pct?: number | null
          iva_withholding_pct?: number | null
          listing_quote_reference_destination?: Json | null
          min_payout_amount_cents?: number | null
          min_version_android?: string | null
          min_version_ios?: string | null
          novice_active_limit?: number | null
          novice_completed_threshold?: number | null
          order_expiration_hours?: number | null
          package_presets?: Json | null
          payout_fee_fixed_cents?: number | null
          preparing_expiration_hours?: number | null
          release_funds_running?: boolean | null
          return_delivery_timeout_running?: boolean | null
          return_label_fee_cents?: number | null
          service_fee_fixed_cents?: number | null
          service_fee_pct?: number | null
          shipping_buffer_cents?: number | null
          track_shipments_preparing_lease_expires_at?: string | null
          track_shipments_preparing_lease_id?: string | null
          track_shipments_shipped_lease_expires_at?: string | null
          track_shipments_shipped_lease_id?: string | null
          trusted_active_limit?: number | null
          updated_at?: string | null
        }
        Update: {
          auto_cancel_orders_running?: boolean | null
          auto_cancel_preparing_running?: boolean | null
          checkout_recovery_enabled?: boolean
          checkout_recovery_running?: boolean
          connect_enabled?: boolean | null
          currency?: string | null
          envia_carrier?: string | null
          envia_print_format?: string | null
          envia_print_size?: string | null
          envia_service?: string | null
          id?: number
          insurance_rate?: number | null
          is_maintenance?: boolean | null
          isr_withholding_pct?: number | null
          iva_withholding_pct?: number | null
          listing_quote_reference_destination?: Json | null
          min_payout_amount_cents?: number | null
          min_version_android?: string | null
          min_version_ios?: string | null
          novice_active_limit?: number | null
          novice_completed_threshold?: number | null
          order_expiration_hours?: number | null
          package_presets?: Json | null
          payout_fee_fixed_cents?: number | null
          preparing_expiration_hours?: number | null
          release_funds_running?: boolean | null
          return_delivery_timeout_running?: boolean | null
          return_label_fee_cents?: number | null
          service_fee_fixed_cents?: number | null
          service_fee_pct?: number | null
          shipping_buffer_cents?: number | null
          track_shipments_preparing_lease_expires_at?: string | null
          track_shipments_preparing_lease_id?: string | null
          track_shipments_shipped_lease_expires_at?: string | null
          track_shipments_shipped_lease_id?: string | null
          trusted_active_limit?: number | null
          updated_at?: string | null
        }
        Relationships: []
      }
      wallet_transactions: {
        Row: {
          amount: number
          balance_after: number
          created_at: string
          description: string | null
          fee_deducted: number | null
          id: string
          insurance_amount: number | null
          net_amount: number
          order_id: string | null
          shipment_id: string | null
          shipping_cost: number | null
          tax_withholding: number | null
          type: Database["public"]["Enums"]["wallet_transaction_type"]
          wallet_id: string
        }
        Insert: {
          amount: number
          balance_after: number
          created_at?: string
          description?: string | null
          fee_deducted?: number | null
          id?: string
          insurance_amount?: number | null
          net_amount: number
          order_id?: string | null
          shipment_id?: string | null
          shipping_cost?: number | null
          tax_withholding?: number | null
          type: Database["public"]["Enums"]["wallet_transaction_type"]
          wallet_id: string
        }
        Update: {
          amount?: number
          balance_after?: number
          created_at?: string
          description?: string | null
          fee_deducted?: number | null
          id?: string
          insurance_amount?: number | null
          net_amount?: number
          order_id?: string | null
          shipment_id?: string | null
          shipping_cost?: number | null
          tax_withholding?: number | null
          type?: Database["public"]["Enums"]["wallet_transaction_type"]
          wallet_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "wallet_transactions_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "admin_disputes_monitor_view"
            referencedColumns: ["order_id"]
          },
          {
            foreignKeyName: "wallet_transactions_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wallet_transactions_shipment_id_fkey"
            columns: ["shipment_id"]
            isOneToOne: false
            referencedRelation: "admin_connect_earnings_view"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wallet_transactions_shipment_id_fkey"
            columns: ["shipment_id"]
            isOneToOne: false
            referencedRelation: "admin_connect_payout_release_view"
            referencedColumns: ["shipment_id"]
          },
          {
            foreignKeyName: "wallet_transactions_shipment_id_fkey"
            columns: ["shipment_id"]
            isOneToOne: false
            referencedRelation: "shipments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wallet_transactions_wallet_id_fkey"
            columns: ["wallet_id"]
            isOneToOne: false
            referencedRelation: "wallets"
            referencedColumns: ["id"]
          },
        ]
      }
      wallets: {
        Row: {
          available_balance: number
          currency: string | null
          id: string
          pending_balance: number
          updated_at: string | null
          user_id: string
        }
        Insert: {
          available_balance?: number
          currency?: string | null
          id?: string
          pending_balance?: number
          updated_at?: string | null
          user_id: string
        }
        Update: {
          available_balance?: number
          currency?: string | null
          id?: string
          pending_balance?: number
          updated_at?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "wallets_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "admin_disputes_monitor_view"
            referencedColumns: ["buyer_id"]
          },
          {
            foreignKeyName: "wallets_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "admin_disputes_monitor_view"
            referencedColumns: ["seller_id"]
          },
          {
            foreignKeyName: "wallets_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "admin_seller_onboarding_view"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wallets_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "admin_user_directory_view"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wallets_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      webhook_deliveries: {
        Row: {
          delivery_id: string
          error_code: string | null
          event_name: string
          id: string
          payload_sha256: string
          processed_at: string | null
          provider: string
          received_at: string
          state: string
        }
        Insert: {
          delivery_id: string
          error_code?: string | null
          event_name: string
          id?: string
          payload_sha256: string
          processed_at?: string | null
          provider: string
          received_at?: string
          state?: string
        }
        Update: {
          delivery_id?: string
          error_code?: string | null
          event_name?: string
          id?: string
          payload_sha256?: string
          processed_at?: string | null
          provider?: string
          received_at?: string
          state?: string
        }
        Relationships: []
      }
      webhook_dlq: {
        Row: {
          created_at: string | null
          error_message: string
          event_type: string | null
          id: string
          payload: Json
          resolved: boolean | null
          resolved_at: string | null
          resolved_by: string | null
        }
        Insert: {
          created_at?: string | null
          error_message: string
          event_type?: string | null
          id?: string
          payload: Json
          resolved?: boolean | null
          resolved_at?: string | null
          resolved_by?: string | null
        }
        Update: {
          created_at?: string | null
          error_message?: string
          event_type?: string | null
          id?: string
          payload?: Json
          resolved?: boolean | null
          resolved_at?: string | null
          resolved_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "webhook_dlq_resolved_by_fkey"
            columns: ["resolved_by"]
            isOneToOne: false
            referencedRelation: "admin_disputes_monitor_view"
            referencedColumns: ["buyer_id"]
          },
          {
            foreignKeyName: "webhook_dlq_resolved_by_fkey"
            columns: ["resolved_by"]
            isOneToOne: false
            referencedRelation: "admin_disputes_monitor_view"
            referencedColumns: ["seller_id"]
          },
          {
            foreignKeyName: "webhook_dlq_resolved_by_fkey"
            columns: ["resolved_by"]
            isOneToOne: false
            referencedRelation: "admin_seller_onboarding_view"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "webhook_dlq_resolved_by_fkey"
            columns: ["resolved_by"]
            isOneToOne: false
            referencedRelation: "admin_user_directory_view"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "webhook_dlq_resolved_by_fkey"
            columns: ["resolved_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      admin_connect_earnings_view: {
        Row: {
          amount: number | null
          application_fee_amount: number | null
          created_at: string | null
          id: string | null
          seller_id: string | null
          seller_name: string | null
          status: string | null
          stripe_payment_intent_id: string | null
        }
        Relationships: [
          {
            foreignKeyName: "shipments_seller_id_fkey"
            columns: ["seller_id"]
            isOneToOne: false
            referencedRelation: "admin_disputes_monitor_view"
            referencedColumns: ["buyer_id"]
          },
          {
            foreignKeyName: "shipments_seller_id_fkey"
            columns: ["seller_id"]
            isOneToOne: false
            referencedRelation: "admin_disputes_monitor_view"
            referencedColumns: ["seller_id"]
          },
          {
            foreignKeyName: "shipments_seller_id_fkey"
            columns: ["seller_id"]
            isOneToOne: false
            referencedRelation: "admin_seller_onboarding_view"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shipments_seller_id_fkey"
            columns: ["seller_id"]
            isOneToOne: false
            referencedRelation: "admin_user_directory_view"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shipments_seller_id_fkey"
            columns: ["seller_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      admin_connect_payout_release_view: {
        Row: {
          completed_at: string | null
          ineligible_reason: string | null
          is_eligible: boolean | null
          order_id: string | null
          release_amount_cents: number | null
          seller_id: string | null
          seller_name: string | null
          shipment_id: string | null
          status: Database["public"]["Enums"]["order_status_enum"] | null
          stripe_account_id: string | null
          stripe_onboarding_status:
            | Database["public"]["Enums"]["stripe_onboarding_status"]
            | null
          stripe_payment_intent_id: string | null
          stripe_transfer_id: string | null
          transfer_group: string | null
        }
        Relationships: [
          {
            foreignKeyName: "shipments_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "admin_disputes_monitor_view"
            referencedColumns: ["order_id"]
          },
          {
            foreignKeyName: "shipments_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shipments_seller_id_fkey"
            columns: ["seller_id"]
            isOneToOne: false
            referencedRelation: "admin_disputes_monitor_view"
            referencedColumns: ["buyer_id"]
          },
          {
            foreignKeyName: "shipments_seller_id_fkey"
            columns: ["seller_id"]
            isOneToOne: false
            referencedRelation: "admin_disputes_monitor_view"
            referencedColumns: ["seller_id"]
          },
          {
            foreignKeyName: "shipments_seller_id_fkey"
            columns: ["seller_id"]
            isOneToOne: false
            referencedRelation: "admin_seller_onboarding_view"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shipments_seller_id_fkey"
            columns: ["seller_id"]
            isOneToOne: false
            referencedRelation: "admin_user_directory_view"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shipments_seller_id_fkey"
            columns: ["seller_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      admin_disputes_monitor_view: {
        Row: {
          buyer_id: string | null
          buyer_username: string | null
          dispute_date: string | null
          dispute_description_preview: string | null
          dispute_id: string | null
          dispute_status: Database["public"]["Enums"]["dispute_status"] | null
          order_id: string | null
          order_status: Database["public"]["Enums"]["order_status_enum"] | null
          resolution_type: string | null
          resolved_at: string | null
          seller_id: string | null
          seller_username: string | null
          total_amount: number | null
        }
        Relationships: []
      }
      admin_payments_overview: {
        Row: {
          account_holder_name: string | null
          amount: number | null
          bank_name: string | null
          clabe: string | null
          completed_at: string | null
          id: string | null
          is_verified: boolean | null
          processed_at: string | null
          processed_by: string | null
          processed_by_name: string | null
          rejected_at: string | null
          rejected_reason: string | null
          requested_at: string | null
          seller_name: string | null
          status: Database["public"]["Enums"]["payout_status"] | null
          user_id: string | null
        }
        Relationships: [
          {
            foreignKeyName: "payout_requests_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "admin_disputes_monitor_view"
            referencedColumns: ["buyer_id"]
          },
          {
            foreignKeyName: "payout_requests_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "admin_disputes_monitor_view"
            referencedColumns: ["seller_id"]
          },
          {
            foreignKeyName: "payout_requests_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "admin_seller_onboarding_view"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payout_requests_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "admin_user_directory_view"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payout_requests_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      admin_product_queue_view: {
        Row: {
          aspect_ratio: number | null
          category: string | null
          condition: string | null
          created_at: string | null
          deleted_at: string | null
          description: string | null
          fts: unknown
          id: string | null
          images: string[] | null
          locked_at: string | null
          locked_by: string | null
          name: string | null
          origin_zip: string | null
          package_preset: string | null
          price: number | null
          rejection_reason: string | null
          reserved_at: string | null
          seller_id: string | null
          shipping_cost: number | null
          shipping_payer: string | null
          specifications: Json | null
          status: Database["public"]["Enums"]["product_status_enum"] | null
          updated_at: string | null
          usage: string | null
          verification_data: Json | null
          verified_at: string | null
          views: number | null
        }
        Insert: {
          aspect_ratio?: number | null
          category?: string | null
          condition?: string | null
          created_at?: string | null
          deleted_at?: string | null
          description?: string | null
          fts?: unknown
          id?: string | null
          images?: string[] | null
          locked_at?: string | null
          locked_by?: string | null
          name?: string | null
          origin_zip?: string | null
          package_preset?: string | null
          price?: number | null
          rejection_reason?: string | null
          reserved_at?: string | null
          seller_id?: string | null
          shipping_cost?: number | null
          shipping_payer?: string | null
          specifications?: Json | null
          status?: Database["public"]["Enums"]["product_status_enum"] | null
          updated_at?: string | null
          usage?: string | null
          verification_data?: Json | null
          verified_at?: string | null
          views?: number | null
        }
        Update: {
          aspect_ratio?: number | null
          category?: string | null
          condition?: string | null
          created_at?: string | null
          deleted_at?: string | null
          description?: string | null
          fts?: unknown
          id?: string | null
          images?: string[] | null
          locked_at?: string | null
          locked_by?: string | null
          name?: string | null
          origin_zip?: string | null
          package_preset?: string | null
          price?: number | null
          rejection_reason?: string | null
          reserved_at?: string | null
          seller_id?: string | null
          shipping_cost?: number | null
          shipping_payer?: string | null
          specifications?: Json | null
          status?: Database["public"]["Enums"]["product_status_enum"] | null
          updated_at?: string | null
          usage?: string | null
          verification_data?: Json | null
          verified_at?: string | null
          views?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "products_locked_by_fkey"
            columns: ["locked_by"]
            isOneToOne: false
            referencedRelation: "admin_disputes_monitor_view"
            referencedColumns: ["buyer_id"]
          },
          {
            foreignKeyName: "products_locked_by_fkey"
            columns: ["locked_by"]
            isOneToOne: false
            referencedRelation: "admin_disputes_monitor_view"
            referencedColumns: ["seller_id"]
          },
          {
            foreignKeyName: "products_locked_by_fkey"
            columns: ["locked_by"]
            isOneToOne: false
            referencedRelation: "admin_seller_onboarding_view"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "products_locked_by_fkey"
            columns: ["locked_by"]
            isOneToOne: false
            referencedRelation: "admin_user_directory_view"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "products_locked_by_fkey"
            columns: ["locked_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "products_seller_id_fkey"
            columns: ["seller_id"]
            isOneToOne: false
            referencedRelation: "admin_disputes_monitor_view"
            referencedColumns: ["buyer_id"]
          },
          {
            foreignKeyName: "products_seller_id_fkey"
            columns: ["seller_id"]
            isOneToOne: false
            referencedRelation: "admin_disputes_monitor_view"
            referencedColumns: ["seller_id"]
          },
          {
            foreignKeyName: "products_seller_id_fkey"
            columns: ["seller_id"]
            isOneToOne: false
            referencedRelation: "admin_seller_onboarding_view"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "products_seller_id_fkey"
            columns: ["seller_id"]
            isOneToOne: false
            referencedRelation: "admin_user_directory_view"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "products_seller_id_fkey"
            columns: ["seller_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      admin_seller_onboarding_view: {
        Row: {
          charges_enabled: boolean | null
          created_at: string | null
          email: string | null
          id: string | null
          stripe_account_id: string | null
          stripe_onboarding_status:
            | Database["public"]["Enums"]["stripe_onboarding_status"]
            | null
          username: string | null
        }
        Relationships: []
      }
      admin_user_directory_view: {
        Row: {
          available_balance: number | null
          avatar_url: string | null
          created_at: string | null
          email: string | null
          id: string | null
          is_verified_seller: boolean | null
          pending_balance: number | null
          role: string | null
          status: Database["public"]["Enums"]["account_status"] | null
          username: string | null
        }
        Relationships: []
      }
      seller_trust_stats: {
        Row: {
          in_review_count: number | null
          processed_count: number | null
          rejected_count: number | null
          seller_id: string | null
          sold_count: number | null
          total_listings: number | null
          verified_count: number | null
        }
        Relationships: [
          {
            foreignKeyName: "products_seller_id_fkey"
            columns: ["seller_id"]
            isOneToOne: false
            referencedRelation: "admin_disputes_monitor_view"
            referencedColumns: ["buyer_id"]
          },
          {
            foreignKeyName: "products_seller_id_fkey"
            columns: ["seller_id"]
            isOneToOne: false
            referencedRelation: "admin_disputes_monitor_view"
            referencedColumns: ["seller_id"]
          },
          {
            foreignKeyName: "products_seller_id_fkey"
            columns: ["seller_id"]
            isOneToOne: false
            referencedRelation: "admin_seller_onboarding_view"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "products_seller_id_fkey"
            columns: ["seller_id"]
            isOneToOne: false
            referencedRelation: "admin_user_directory_view"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "products_seller_id_fkey"
            columns: ["seller_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Functions: {
      backfill_product_publication_economics: {
        Args: { p_product_id: string }
        Returns: {
          publication_commission_rate: number
          publication_insurance_rate: number
          publication_shipping_reserve_cents: number
        }[]
      }
      fn_acquire_track_shipments_lease: {
        Args: { p_lane: string }
        Returns: {
          acquired: boolean
          lease_expires_at: string
          lease_id: string
        }[]
      }
      fn_admin_restore_product: {
        Args: { p_product_id: string }
        Returns: boolean
      }
      fn_admin_soft_delete_product: {
        Args: { p_product_id: string; p_reason: string }
        Returns: boolean
      }
      fn_admin_toggle_verified_seller: {
        Args: {
          p_admin_id: string
          p_is_verified: boolean
          p_target_user_id: string
        }
        Returns: boolean
      }
      fn_admin_update_user_status: {
        Args: {
          p_admin_id: string
          p_new_status: Database["public"]["Enums"]["account_status"]
          p_reason: string
          p_target_user_id: string
        }
        Returns: boolean
      }
      fn_buyer_submit_return_evidence: {
        Args: { p_dispute_id: string; p_images: string[] }
        Returns: {
          error_message: string
          success: boolean
        }[]
      }
      fn_cancel_order: {
        Args: {
          p_cancelled_by_role: string
          p_order_id: string
          p_reason: string
        }
        Returns: {
          error_message: string
          success: boolean
        }[]
      }
      fn_cancel_shipment: {
        Args: {
          p_cancellation_loss_cents?: number
          p_cancelled_by_role: string
          p_reason: string
          p_shipment_id: string
        }
        Returns: {
          error_message: string
          success: boolean
        }[]
      }
      fn_claim_checkout_recovery_shells: {
        Args: {
          p_claim_scope?: string
          p_limit?: number
          p_stripe_payment_intent_id?: string
        }
        Returns: {
          stripe_charge_id: string
          stripe_payment_intent_id: string
        }[]
      }
      fn_claim_shipment_label: {
        Args: {
          p_origin_address_id: string
          p_seller_id: string
          p_shipment_id: string
        }
        Returns: Json
      }
      fn_complete_shipment_refund: {
        Args: { p_shipment_id: string }
        Returns: {
          error_message: string
          success: boolean
        }[]
      }
      fn_confirm_shipment_delivery: {
        Args: {
          p_actor_id: string
          p_idempotency_key: string
          p_shipment_id: string
          p_source: string
        }
        Returns: {
          completion_source: string
          error: string
          idempotent: boolean
          success: boolean
        }[]
      }
      fn_create_order_from_payment: {
        Args: {
          p_address_id: string
          p_buyer_id: string
          p_product_ids: string[]
          p_service_fee: number
          p_stripe_intent_id: string
          p_total_amount: number
        }
        Returns: {
          error_message: string
          success: boolean
        }[]
      }
      fn_create_shipment_from_payment: {
        Args: {
          p_amount_received: number
          p_metadata: Json
          p_stripe_payment_intent_id: string
        }
        Returns: Json
      }
      fn_create_shipments_from_single_payment: {
        Args: {
          p_allocation: Json
          p_amount_received: number
          p_stripe_charge_id: string
          p_stripe_payment_intent_id: string
          p_transfer_group: string
        }
        Returns: Json
      }
      fn_cron_dispute_payout_timeout: { Args: never; Returns: undefined }
      fn_cron_dispute_shipping_timeout: { Args: never; Returns: undefined }
      fn_cron_release_shipment_funds: {
        Args: never
        Returns: {
          total_errors: number
          total_processed: number
        }[]
      }
      fn_cron_return_delivery_timeout: {
        Args: never
        Returns: {
          total_errors: number
          total_processed: number
        }[]
      }
      fn_derive_order_status: {
        Args: { p_order_id: string }
        Returns: Database["public"]["Enums"]["order_status_enum"]
      }
      fn_finalize_checkout_recovery: {
        Args: { p_stripe_payment_intent_id: string; p_stripe_refund_id: string }
        Returns: Json
      }
      fn_finalize_shipment_label: {
        Args: {
          p_carrier: string
          p_claim_token: string
          p_envia_shipment_id: string
          p_label_url: string
          p_print_format: string
          p_print_size: string
          p_provider_cost_cents: number
          p_service: string
          p_shipment_id: string
          p_tracking_number: string
        }
        Returns: boolean
      }
      fn_get_location_by_zip: {
        Args: { p_zip: string }
        Returns: {
          city: string
          districts: string[]
          state_code: string
          state_name: string
        }[]
      }
      fn_lock_dispute: {
        Args: { p_dispute_id: string }
        Returns: {
          locked_at: string
          locker_name: string
          success: boolean
        }[]
      }
      fn_lock_product: {
        Args: { p_product_id: string }
        Returns: {
          locked_at: string
          locked_by_username: string
          success: boolean
        }[]
      }
      fn_log_return_payment: {
        Args: { p_amount: number; p_dispute_id: string; p_stripe_id: string }
        Returns: undefined
      }
      fn_mark_checkout_recovery_reconciliation_needed: {
        Args: { p_error: string; p_stripe_payment_intent_id: string }
        Returns: undefined
      }
      fn_mark_checkout_recovery_retry: {
        Args: { p_error: string; p_stripe_payment_intent_id: string }
        Returns: undefined
      }
      fn_mark_return_delivered: {
        Args: { p_dispute_id: string }
        Returns: {
          error_message: string
          success: boolean
        }[]
      }
      fn_mark_shipment_delivered: {
        Args: { p_shipment_id: string }
        Returns: {
          error_message: string
          success: boolean
        }[]
      }
      fn_mark_shipment_label_orphan: {
        Args: {
          p_claim_token: string
          p_error_class: string
          p_shipment_id: string
        }
        Returns: boolean
      }
      fn_mark_shipment_label_rejected: {
        Args: {
          p_claim_token: string
          p_error_class: string
          p_shipment_id: string
        }
        Returns: boolean
      }
      fn_mark_shipment_label_sent: {
        Args: { p_claim_token: string; p_shipment_id: string }
        Returns: boolean
      }
      fn_persist_shipment_label_quote: {
        Args: {
          p_carrier: string
          p_claim_token: string
          p_input_hash: string
          p_quote_cost_cents: number
          p_quote_reference: string
          p_service: string
          p_shipment_id: string
        }
        Returns: boolean
      }
      fn_reconcile_connect_payments: {
        Args: never
        Returns: {
          action: string
          shipment_id: string
          status: string
        }[]
      }
      fn_reconcile_shipment_label: {
        Args: {
          p_actor_id: string
          p_carrier: string
          p_envia_shipment_id: string
          p_label_url: string
          p_print_format: string
          p_print_size: string
          p_provider_cost_cents: number
          p_service: string
          p_shipment_id: string
          p_tracking_number: string
        }
        Returns: boolean
      }
      fn_record_tracking_event: {
        Args: {
          p_carrier_name: string
          p_dispute_id: string
          p_event_at: string
          p_event_type: Database["public"]["Enums"]["shipment_tracking_event_type"]
          p_location: string
          p_polling_run_id: string
          p_raw_status: string
          p_shipment_id: string
          p_status_description: string
          p_transition: Database["public"]["Enums"]["order_status_enum"]
          p_webhook_delivery_id: string
        }
        Returns: Json
      }
      fn_refresh_seller_stats: {
        Args: { p_seller_id: string }
        Returns: undefined
      }
      fn_release_products: {
        Args: { p_product_ids: string[] }
        Returns: {
          success: boolean
        }[]
      }
      fn_release_shipment_funds: {
        Args: { p_shipment_id: string }
        Returns: {
          error_message: string
          success: boolean
        }[]
      }
      fn_release_stale_reservations: {
        Args: { p_product_ids?: string[] }
        Returns: {
          released_id: string
        }[]
      }
      fn_release_track_shipments_lease: {
        Args: { p_lane: string; p_lease_id: string }
        Returns: boolean
      }
      fn_request_payout: {
        Args: { p_amount: number; p_bank_account_id: string }
        Returns: {
          error_message: string
          success: boolean
        }[]
      }
      fn_reserve_products: {
        Args: { p_buyer_id: string; p_product_ids: string[] }
        Returns: {
          error_message: string
          success: boolean
          total_price: number
        }[]
      }
      fn_resolve_dispute_to_buyer: {
        Args: { p_admin_note: string; p_dispute_id: string }
        Returns: {
          error_message: string
          success: boolean
        }[]
      }
      fn_resolve_dispute_to_seller: {
        Args: { p_admin_note: string; p_dispute_id: string }
        Returns: {
          error_message: string
          success: boolean
        }[]
      }
      fn_resolve_product_verdict: {
        Args: {
          p_private_note?: string
          p_product_id: string
          p_public_note?: string
          p_verdict: string
        }
        Returns: boolean
      }
      fn_save_bank_account: {
        Args: { p_clabe: string; p_holder_name: string }
        Returns: {
          bank_name: string
          error_message: string
          success: boolean
        }[]
      }
      fn_seller_confirm_return_shipment: {
        Args: { p_shipment_id: string }
        Returns: {
          error_message: string
          success: boolean
        }[]
      }
      fn_seller_initiate_return_label: {
        Args: { p_caller_id: string; p_dispute_id: string }
        Returns: {
          error_message: string
          success: boolean
        }[]
      }
      fn_seller_submit_return_evidence: {
        Args: { p_dispute_id: string; p_images: string[]; p_video_url?: string }
        Returns: {
          error_message: string
          success: boolean
        }[]
      }
      fn_set_checkout_recovery_charge_evidence: {
        Args: { p_stripe_charge_id: string; p_stripe_payment_intent_id: string }
        Returns: string
      }
      fn_unlock_dispute: { Args: { p_dispute_id: string }; Returns: boolean }
      fn_unlock_product: { Args: { p_product_id: string }; Returns: boolean }
      fn_upsert_checkout_recovery_shell: {
        Args: {
          p_charged_amount_cents: number
          p_reason: string
          p_source_metadata: Json
          p_stripe_charge_id?: string
          p_stripe_payment_intent_id: string
        }
        Returns: Json
      }
      get_profile_stats: { Args: { target_user_id: string }; Returns: Json }
      is_admin: { Args: never; Returns: boolean }
      normalize_publication_rate: { Args: { p_rate: number }; Returns: number }
    }
    Enums: {
      account_status: "active" | "suspended" | "banned"
      dispute_reason:
        | "damaged"
        | "not_working"
        | "wrong_item"
        | "incomplete"
        | "other"
      dispute_status:
        | "open"
        | "under_review"
        | "waiting_return"
        | "resolved"
        | "rejected"
        | "return_shipped"
        | "return_delivered"
      order_status_enum:
        | "pending"
        | "paid"
        | "preparing"
        | "shipped"
        | "delivered"
        | "completed"
        | "cancelled"
        | "dispute"
        | "refunded"
      payout_status: "pending" | "processing" | "completed" | "rejected"
      product_status_enum:
        | "PENDING_VERIFICATION"
        | "IN_REVIEW"
        | "VERIFIED"
        | "SOLD"
        | "REJECTED"
        | "HIDDEN"
        | "RESERVED"
        | "IN_DISPUTE"
      shipment_tracking_event_type:
        | "created"
        | "information"
        | "in_transit"
        | "delivered"
        | "exception"
        | "returned"
      stripe_onboarding_status: "pending" | "complete" | "rejected"
      wallet_transaction_type:
        | "sale_proceeds"
        | "payout"
        | "refund"
        | "adjustment"
        | "release"
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
      account_status: ["active", "suspended", "banned"],
      dispute_reason: [
        "damaged",
        "not_working",
        "wrong_item",
        "incomplete",
        "other",
      ],
      dispute_status: [
        "open",
        "under_review",
        "waiting_return",
        "resolved",
        "rejected",
        "return_shipped",
        "return_delivered",
      ],
      order_status_enum: [
        "pending",
        "paid",
        "preparing",
        "shipped",
        "delivered",
        "completed",
        "cancelled",
        "dispute",
        "refunded",
      ],
      payout_status: ["pending", "processing", "completed", "rejected"],
      product_status_enum: [
        "PENDING_VERIFICATION",
        "IN_REVIEW",
        "VERIFIED",
        "SOLD",
        "REJECTED",
        "HIDDEN",
        "RESERVED",
        "IN_DISPUTE",
      ],
      shipment_tracking_event_type: [
        "created",
        "information",
        "in_transit",
        "delivered",
        "exception",
        "returned",
      ],
      stripe_onboarding_status: ["pending", "complete", "rejected"],
      wallet_transaction_type: [
        "sale_proceeds",
        "payout",
        "refund",
        "adjustment",
        "release",
      ],
    },
  },
} as const
