
export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[]

export type Database = {
  
  "public": {
          Tables: {
            "conversations": {
                  Row: {
                    "closed_at": string | null,"created_at": string,"flight_request_id": string,"id": string,"owner_id": string,"requester_id": string
                  }
                  Insert: {
                    "closed_at"?: string | null,"created_at"?: string,"flight_request_id": string,"id"?: string,"owner_id": string,"requester_id": string
                  }
                  Update: {
                    "closed_at"?: string | null,"created_at"?: string,"flight_request_id"?: string,"id"?: string,"owner_id"?: string,"requester_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "conversations_flight_request_id_fkey"
      columns: ["flight_request_id"]
isOneToOne: true
      referencedRelation: "flight_requests"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "conversations_owner_id_fkey"
      columns: ["owner_id"]
isOneToOne: false
      referencedRelation: "memberships"
      referencedColumns: ["user_id"]
    },{
      foreignKeyName: "conversations_requester_id_fkey"
      columns: ["requester_id"]
isOneToOne: false
      referencedRelation: "memberships"
      referencedColumns: ["user_id"]
    }
                  ]
                },"flight_moderation_audit": {
                  Row: {
                    "action": string,"actor_id": string,"created_at": string,"flight_id": string,"id": string,"reason": string
                  }
                  Insert: {
                    "action"?: string,"actor_id": string,"created_at": string,"flight_id": string,"id"?: string,"reason": string
                  }
                  Update: {
                    "action"?: string,"actor_id"?: string,"created_at"?: string,"flight_id"?: string,"id"?: string,"reason"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "flight_moderation_audit_actor_id_fkey"
      columns: ["actor_id"]
isOneToOne: false
      referencedRelation: "memberships"
      referencedColumns: ["user_id"]
    },{
      foreignKeyName: "flight_moderation_audit_flight_id_fkey"
      columns: ["flight_id"]
isOneToOne: true
      referencedRelation: "flights"
      referencedColumns: ["id"]
    }
                  ]
                },"flight_recipients": {
                  Row: {
                    "added_at": string,"flight_id": string,"user_id": string
                  }
                  Insert: {
                    "added_at"?: string,"flight_id": string,"user_id": string
                  }
                  Update: {
                    "added_at"?: string,"flight_id"?: string,"user_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "flight_recipients_flight_id_fkey"
      columns: ["flight_id"]
isOneToOne: false
      referencedRelation: "flights"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "flight_recipients_user_id_fkey"
      columns: ["user_id"]
isOneToOne: false
      referencedRelation: "memberships"
      referencedColumns: ["user_id"]
    }
                  ]
                },"flight_requests": {
                  Row: {
                    "created_at": string,"flight_id": string,"id": string,"introductory_note": string | null,"requester_id": string,"status": Database["public"]['Enums']["flight_request_status"],"status_changed_at": string,"updated_at": string
                  }
                  Insert: {
                    "created_at"?: string,"flight_id": string,"id"?: string,"introductory_note"?: string | null,"requester_id": string,"status"?: Database["public"]['Enums']["flight_request_status"],"status_changed_at"?: string,"updated_at"?: string
                  }
                  Update: {
                    "created_at"?: string,"flight_id"?: string,"id"?: string,"introductory_note"?: string | null,"requester_id"?: string,"status"?: Database["public"]['Enums']["flight_request_status"],"status_changed_at"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "flight_requests_flight_id_fkey"
      columns: ["flight_id"]
isOneToOne: false
      referencedRelation: "flights"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "flight_requests_requester_id_fkey"
      columns: ["requester_id"]
isOneToOne: false
      referencedRelation: "memberships"
      referencedColumns: ["user_id"]
    }
                  ]
                },"flights": {
                  Row: {
                    "aircraft_description": string,"created_at": string,"departure_airport": string,"departure_at": string,"departure_local_date": string,"departure_timezone": string,"destination_airport": string,"id": string,"moderated_at": string | null,"notes": string | null,"owner_id": string,"pilot_places": number,"status": Database["public"]['Enums']["flight_status"],"updated_at": string,"visibility": Database["public"]['Enums']["flight_visibility"]
                  }
                  Insert: {
                    "aircraft_description": string,"created_at"?: string,"departure_airport": string,"departure_at": string,"departure_local_date": string,"departure_timezone": string,"destination_airport": string,"id"?: string,"moderated_at"?: string | null,"notes"?: string | null,"owner_id"?: string,"pilot_places": number,"status"?: Database["public"]['Enums']["flight_status"],"updated_at"?: string,"visibility": Database["public"]['Enums']["flight_visibility"]
                  }
                  Update: {
                    "aircraft_description"?: string,"created_at"?: string,"departure_airport"?: string,"departure_at"?: string,"departure_local_date"?: string,"departure_timezone"?: string,"destination_airport"?: string,"id"?: string,"moderated_at"?: string | null,"notes"?: string | null,"owner_id"?: string,"pilot_places"?: number,"status"?: Database["public"]['Enums']["flight_status"],"updated_at"?: string,"visibility"?: Database["public"]['Enums']["flight_visibility"]
                  }
                  Relationships: [
                    {
      foreignKeyName: "flights_owner_id_fkey"
      columns: ["owner_id"]
isOneToOne: false
      referencedRelation: "memberships"
      referencedColumns: ["user_id"]
    }
                  ]
                },"invitation_confirmation_transports": {
                  Row: {
                    "ciphertext": string | null,"claimed_at": string | null,"created_at": string,"csrf_digest": string,"expires_at": string,"key_id": string,"lookup_digest": string,"nonce": string | null,"origin": string,"tag": string | null
                  }
                  Insert: {
                    "ciphertext"?: string | null,"claimed_at"?: string | null,"created_at"?: string,"csrf_digest": string,"expires_at": string,"key_id": string,"lookup_digest": string,"nonce"?: string | null,"origin": string,"tag"?: string | null
                  }
                  Update: {
                    "ciphertext"?: string | null,"claimed_at"?: string | null,"created_at"?: string,"csrf_digest"?: string,"expires_at"?: string,"key_id"?: string,"lookup_digest"?: string,"nonce"?: string | null,"origin"?: string,"tag"?: string | null
                  }
                  Relationships: [
                    
                  ]
                },"invitation_send_attempts": {
                  Row: {
                    "completed_at": string | null,"id": string,"invitation_id": string,"invitation_version": number,"kind": Database["public"]['Enums']["invitation_send_kind"],"outcome": Database["public"]['Enums']["invitation_send_outcome"],"provider_error_code": string | null,"reconciled_at": string | null,"reconciled_outcome": Database["public"]['Enums']["invitation_send_resolution"] | null,"requested_by_user_id": string,"started_at": string
                  }
                  Insert: {
                    "completed_at"?: string | null,"id"?: string,"invitation_id": string,"invitation_version": number,"kind": Database["public"]['Enums']["invitation_send_kind"],"outcome"?: Database["public"]['Enums']["invitation_send_outcome"],"provider_error_code"?: string | null,"reconciled_at"?: string | null,"reconciled_outcome"?: Database["public"]['Enums']["invitation_send_resolution"] | null,"requested_by_user_id": string,"started_at"?: string
                  }
                  Update: {
                    "completed_at"?: string | null,"id"?: string,"invitation_id"?: string,"invitation_version"?: number,"kind"?: Database["public"]['Enums']["invitation_send_kind"],"outcome"?: Database["public"]['Enums']["invitation_send_outcome"],"provider_error_code"?: string | null,"reconciled_at"?: string | null,"reconciled_outcome"?: Database["public"]['Enums']["invitation_send_resolution"] | null,"requested_by_user_id"?: string,"started_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "invitation_send_attempts_invitation_id_fkey"
      columns: ["invitation_id"]
isOneToOne: false
      referencedRelation: "invitations"
      referencedColumns: ["id"]
    }
                  ]
                },"invitation_send_proofs": {
                  Row: {
                    "attempt_id": string,"consumed_at": string | null,"secret_digest": string,"transport": string
                  }
                  Insert: {
                    "attempt_id": string,"consumed_at"?: string | null,"secret_digest": string,"transport": string
                  }
                  Update: {
                    "attempt_id"?: string,"consumed_at"?: string | null,"secret_digest"?: string,"transport"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "invitation_send_proofs_attempt_id_fkey"
      columns: ["attempt_id"]
isOneToOne: true
      referencedRelation: "invitation_send_attempts"
      referencedColumns: ["id"]
    }
                  ]
                },"invitation_setup_authorizations": {
                  Row: {
                    "created_at": string,"expires_at": string,"id": string,"invitation_id": string,"invitation_version": number,"lookup_digest": string,"origin": string,"password_operation_id": string | null,"password_started_at": string | null,"session_id": string,"verified_user_id": string
                  }
                  Insert: {
                    "created_at"?: string,"expires_at": string,"id"?: string,"invitation_id": string,"invitation_version": number,"lookup_digest": string,"origin": string,"password_operation_id"?: string | null,"password_started_at"?: string | null,"session_id": string,"verified_user_id": string
                  }
                  Update: {
                    "created_at"?: string,"expires_at"?: string,"id"?: string,"invitation_id"?: string,"invitation_version"?: number,"lookup_digest"?: string,"origin"?: string,"password_operation_id"?: string | null,"password_started_at"?: string | null,"session_id"?: string,"verified_user_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "invitation_setup_authorizations_invitation_id_fkey"
      columns: ["invitation_id"]
isOneToOne: true
      referencedRelation: "invitations"
      referencedColumns: ["id"]
    }
                  ]
                },"invitations": {
                  Row: {
                    "auth_user_id": string | null,"created_at": string,"id": string,"invited_by_user_id": string,"password_established_at": string | null,"recipient_email": string,"recipient_email_key": string,"redeemed_at": string | null,"revocation_reason": string | null,"revoked_at": string | null,"revoked_by_user_id": string | null,"setup_authorization_id": string | null,"status": Database["public"]['Enums']["invitation_status"],"superseded_at": string | null,"superseded_by_id": string | null,"updated_at": string,"verified_at": string | null,"verified_user_id": string | null,"version": number
                  }
                  Insert: {
                    "auth_user_id"?: string | null,"created_at"?: string,"id"?: string,"invited_by_user_id": string,"password_established_at"?: string | null,"recipient_email": string,"recipient_email_key"?: never,"redeemed_at"?: string | null,"revocation_reason"?: string | null,"revoked_at"?: string | null,"revoked_by_user_id"?: string | null,"setup_authorization_id"?: string | null,"status"?: Database["public"]['Enums']["invitation_status"],"superseded_at"?: string | null,"superseded_by_id"?: string | null,"updated_at"?: string,"verified_at"?: string | null,"verified_user_id"?: string | null,"version"?: number
                  }
                  Update: {
                    "auth_user_id"?: string | null,"created_at"?: string,"id"?: string,"invited_by_user_id"?: string,"password_established_at"?: string | null,"recipient_email"?: string,"recipient_email_key"?: never,"redeemed_at"?: string | null,"revocation_reason"?: string | null,"revoked_at"?: string | null,"revoked_by_user_id"?: string | null,"setup_authorization_id"?: string | null,"status"?: Database["public"]['Enums']["invitation_status"],"superseded_at"?: string | null,"superseded_by_id"?: string | null,"updated_at"?: string,"verified_at"?: string | null,"verified_user_id"?: string | null,"version"?: number
                  }
                  Relationships: [
                    {
      foreignKeyName: "invitations_superseded_by_id_fkey"
      columns: ["superseded_by_id"]
isOneToOne: false
      referencedRelation: "invitations"
      referencedColumns: ["id"]
    }
                  ]
                },"member_admin_audit": {
                  Row: {
                    "action": string,"actor_id": string,"created_at": string,"id": string,"reason": string,"target_id": string
                  }
                  Insert: {
                    "action"?: string,"actor_id": string,"created_at": string,"id"?: string,"reason": string,"target_id": string
                  }
                  Update: {
                    "action"?: string,"actor_id"?: string,"created_at"?: string,"id"?: string,"reason"?: string,"target_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "member_admin_audit_actor_id_fkey"
      columns: ["actor_id"]
isOneToOne: false
      referencedRelation: "memberships"
      referencedColumns: ["user_id"]
    },{
      foreignKeyName: "member_admin_audit_target_id_fkey"
      columns: ["target_id"]
isOneToOne: false
      referencedRelation: "memberships"
      referencedColumns: ["user_id"]
    }
                  ]
                },"memberships": {
                  Row: {
                    "created_at": string,"deleted_at": string | null,"deletion_started_at": string | null,"disabled_at": string | null,"disabled_reason": string | null,"role": Database["public"]['Enums']["member_role"],"status": Database["public"]['Enums']["membership_status"],"user_id": string
                  }
                  Insert: {
                    "created_at"?: string,"deleted_at"?: string | null,"deletion_started_at"?: string | null,"disabled_at"?: string | null,"disabled_reason"?: string | null,"role"?: Database["public"]['Enums']["member_role"],"status"?: Database["public"]['Enums']["membership_status"],"user_id": string
                  }
                  Update: {
                    "created_at"?: string,"deleted_at"?: string | null,"deletion_started_at"?: string | null,"disabled_at"?: string | null,"disabled_reason"?: string | null,"role"?: Database["public"]['Enums']["member_role"],"status"?: Database["public"]['Enums']["membership_status"],"user_id"?: string
                  }
                  Relationships: [
                    
                  ]
                },"messages": {
                  Row: {
                    "body": string,"conversation_id": string,"created_at": string,"id": string,"sender_id": string
                  }
                  Insert: {
                    "body": string,"conversation_id": string,"created_at"?: string,"id"?: string,"sender_id": string
                  }
                  Update: {
                    "body"?: string,"conversation_id"?: string,"created_at"?: string,"id"?: string,"sender_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "messages_conversation_id_fkey"
      columns: ["conversation_id"]
isOneToOne: false
      referencedRelation: "conversations"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "messages_sender_id_fkey"
      columns: ["sender_id"]
isOneToOne: false
      referencedRelation: "memberships"
      referencedColumns: ["user_id"]
    }
                  ]
                },"notifications": {
                  Row: {
                    "created_at": string,"event_key": string,"event_type": string,"id": string,"message_id": string | null,"read_at": string | null,"recipient_id": string,"request_id": string | null
                  }
                  Insert: {
                    "created_at"?: string,"event_key": string,"event_type": string,"id"?: string,"message_id"?: string | null,"read_at"?: string | null,"recipient_id": string,"request_id"?: string | null
                  }
                  Update: {
                    "created_at"?: string,"event_key"?: string,"event_type"?: string,"id"?: string,"message_id"?: string | null,"read_at"?: string | null,"recipient_id"?: string,"request_id"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "notifications_message_id_fkey"
      columns: ["message_id"]
isOneToOne: false
      referencedRelation: "messages"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "notifications_recipient_id_fkey"
      columns: ["recipient_id"]
isOneToOne: false
      referencedRelation: "memberships"
      referencedColumns: ["user_id"]
    },{
      foreignKeyName: "notifications_request_id_fkey"
      columns: ["request_id"]
isOneToOne: false
      referencedRelation: "flight_requests"
      referencedColumns: ["id"]
    }
                  ]
                },"password_recovery_authorizations": {
                  Row: {
                    "consumed_at": string | null,"created_at": string,"email_key": string,"expires_at": string,"lookup_digest": string,"origin": string,"session_id": string,"subject": string
                  }
                  Insert: {
                    "consumed_at"?: string | null,"created_at": string,"email_key": string,"expires_at": string,"lookup_digest": string,"origin": string,"session_id": string,"subject": string
                  }
                  Update: {
                    "consumed_at"?: string | null,"created_at"?: string,"email_key"?: string,"expires_at"?: string,"lookup_digest"?: string,"origin"?: string,"session_id"?: string,"subject"?: string
                  }
                  Relationships: [
                    
                  ]
                },"profile_photo_objects": {
                  Row: {
                    "cleanup_token": string | null,"cleanup_until": string | null,"expected_path": string | null,"expected_revision": number,"expires_at": string,"final_path": string,"id": string,"owner_id": string,"processing_until": string | null,"source_deleted": boolean,"source_path": string,"state": string
                  }
                  Insert: {
                    "cleanup_token"?: string | null,"cleanup_until"?: string | null,"expected_path"?: string | null,"expected_revision": number,"expires_at"?: string,"final_path": string,"id"?: string,"owner_id": string,"processing_until"?: string | null,"source_deleted"?: boolean,"source_path": string,"state"?: string
                  }
                  Update: {
                    "cleanup_token"?: string | null,"cleanup_until"?: string | null,"expected_path"?: string | null,"expected_revision"?: number,"expires_at"?: string,"final_path"?: string,"id"?: string,"owner_id"?: string,"processing_until"?: string | null,"source_deleted"?: boolean,"source_path"?: string,"state"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "profile_photo_objects_owner_id_fkey"
      columns: ["owner_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["user_id"]
    }
                  ]
                },"profiles": {
                  Row: {
                    "aircraft_access": string | null,"bio": string | null,"certificates": (string)[],"created_at": string,"display_name": string,"flying_interests": string | null,"home_airport": string,"photo_revision": number,"photo_storage_path": string | null,"pilot_designation": Database["public"]['Enums']["pilot_designation"],"ratings": (string)[],"updated_at": string,"user_id": string
                  }
                  Insert: {
                    "aircraft_access"?: string | null,"bio"?: string | null,"certificates"?: (string)[],"created_at"?: string,"display_name": string,"flying_interests"?: string | null,"home_airport": string,"photo_revision"?: number,"photo_storage_path"?: string | null,"pilot_designation": Database["public"]['Enums']["pilot_designation"],"ratings"?: (string)[],"updated_at"?: string,"user_id"?: string
                  }
                  Update: {
                    "aircraft_access"?: string | null,"bio"?: string | null,"certificates"?: (string)[],"created_at"?: string,"display_name"?: string,"flying_interests"?: string | null,"home_airport"?: string,"photo_revision"?: number,"photo_storage_path"?: string | null,"pilot_designation"?: Database["public"]['Enums']["pilot_designation"],"ratings"?: (string)[],"updated_at"?: string,"user_id"?: string
                  }
                  Relationships: [
                    
                  ]
                },"reports": {
                  Row: {
                    "created_at": string,"id": string,"reason": string,"reporter_id": string,"target_id": string,"target_type": string
                  }
                  Insert: {
                    "created_at"?: string,"id": string,"reason": string,"reporter_id": string,"target_id": string,"target_type": string
                  }
                  Update: {
                    "created_at"?: string,"id"?: string,"reason"?: string,"reporter_id"?: string,"target_id"?: string,"target_type"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "reports_reporter_id_fkey"
      columns: ["reporter_id"]
isOneToOne: false
      referencedRelation: "memberships"
      referencedColumns: ["user_id"]
    }
                  ]
                }
          }
          Views: {
            [_ in never]: never
          }
          Functions: {
            "abandon_profile_photo":
{ Args: { "reservation_id": string }; Returns: Json
                           },
"ack_profile_photo_cleanup":
{ Args: { "claim_token": string,"final_deleted": boolean,"reservation_id": string,"source_deleted": boolean }; Returns: Json
                           },
"admin_account_deletion_preview":
{ Args: { "p_subject_id": string }; Returns: Json
                           },
"admin_account_deletion_status":
{ Args: { "p_request_id": string }; Returns: Json
                           },
"admin_begin_account_deletion":
{ Args: { "p_confirmation": string,"p_reference": string,"p_request_id": string,"p_subject_id": string }; Returns: Json
                           },
"admin_complete_account_deletion":
{ Args: { "p_request_id": string }; Returns: Json
                           },
"admin_disable_member":
{ Args: { "p_reason": string,"p_target_id": string }; Returns: Json
                           },
"admin_finish_deletion_photos":
{ Args: { "p_request_id": string }; Returns: Json
                           },
"admin_flight_overview":
{ Args: { "p_after_flight_id"?: string }; Returns: Json
                           },
"admin_hide_flight":
{ Args: { "p_flight_id": string,"p_reason": string }; Returns: Json
                           },
"admin_member_overview":
{ Args: { "p_after_user_id"?: string }; Returns: Json
                           },
"admin_mvp_metrics":
{ Args: Record<PropertyKey, never>; Returns: Json
                           },
"admin_prepare_account_deletion":
{ Args: { "p_request_id": string }; Returns: Json
                           },
"attach_profile_photo":
{ Args: { "reservation_id": string }; Returns: Json
                           },
"begin_invitation_completion":
{ Args: { "p_email": string,"p_operation_id": string,"p_origin": string,"p_session_id": string,"p_setup_digest": string,"p_subject": string }; Returns: Json
                           },
"begin_profile_photo_finalize":
{ Args: { "reservation_id": string }; Returns: Json
                           },
"bind_invitation_send_subject":
{ Args: { "p_attempt_id": string,"p_expected_version": number,"p_requester_id": string,"p_subject_id": string }; Returns: Json
                           },
"cancel_flight":
{ Args: { "p_flight_id": string }; Returns: Json
                           },
"change_flight_recipient":
{ Args: { "p_flight_id": string,"p_recipient_id": string,"p_selected": boolean }; Returns: string
                           },
"claim_invitation_confirmation_transport":
{ Args: { "p_csrf_digest": string,"p_lookup_digest": string,"p_origin": string }; Returns: Json
                           },
"claim_password_recovery":
{ Args: { "p_digest": string,"p_email": string,"p_origin": string,"p_session_id": string,"p_subject": string }; Returns: Json
                           },
"claim_profile_photo_cleanup":
{ Args: { "batch_size"?: number,"cleanup_owner"?: string }; Returns: {
              "claim_token": string,"final_path": string,"id": string,"lease_until": string,"source_path": string
            }[]
                           },
"cleanup_invitation_confirmation":
{ Args: Record<PropertyKey, never>; Returns: undefined
                           },
"cleanup_password_recovery":
{ Args: Record<PropertyKey, never>; Returns: undefined
                           },
"consume_invitation_send_proof":
{ Args: { "p_attempt_id": string,"p_expected_version": number,"p_secret_digest": string,"p_transport": string,"p_verified_subject": string }; Returns: Json
                           },
"conversation_has_deleted_pilot":
{ Args: { "p_conversation_id": string }; Returns: boolean
                           },
"count_profile_photo_cleanup":
{ Args: { "cleanup_owner"?: string }; Returns: number
                           },
"create_flight":
{ Args: { "p_aircraft_description": string,"p_departure_airport": string,"p_departure_at": string,"p_departure_timezone": string,"p_destination_airport": string,"p_notes": string,"p_pilot_places": number,"p_visibility": Database["public"]['Enums']["flight_visibility"] }; Returns: string
                           },
"create_invitation_confirmation_transport":
{ Args: { "p_ciphertext": string,"p_csrf_digest": string,"p_expires_at": string,"p_key_id": string,"p_lookup_digest": string,"p_nonce": string,"p_origin": string,"p_previous_digest"?: string,"p_tag": string }; Returns: Json
                           },
"create_private_flight":
{ Args: { "p_aircraft_description": string,"p_departure_airport": string,"p_departure_at": string,"p_departure_timezone": string,"p_destination_airport": string,"p_notes": string,"p_pilot_places": number,"p_recipient_ids": (string)[] }; Returns: string
                           },
"decide_flight_request":
{ Args: { "p_decision": string,"p_flight_id": string,"p_request_id": string }; Returns: Json
                           },
"edit_flight":
{ Args: { "p_aircraft_description": string,"p_departure_airport": string,"p_departure_at": string,"p_departure_timezone": string,"p_destination_airport": string,"p_expected_updated_at": string,"p_flight_id": string,"p_notes": string,"p_pilot_places": number }; Returns: Json
                           },
"get_flight_connection":
{ Args: { "p_request_id": string }; Returns: Json
                           },
"get_network_profile":
{ Args: { "p_user_id": string }; Returns: {
              "aircraft_access": string,"bio": string,"certificates": (string)[],"display_name": string,"flying_interests": string,"home_airport": string,"photo_available": boolean,"pilot_designation": Database["public"]['Enums']["pilot_designation"],"ratings": (string)[],"user_id": string
            }[]
                           },
"get_or_create_flight_conversation":
{ Args: { "p_request_id": string }; Returns: string
                           },
"is_flight_hidden_for_participant":
{ Args: { "p_flight_id": string }; Returns: boolean
                           },
"list_directory_profiles":
{ Args: { "p_after"?: string,"p_aircraft"?: string,"p_certificate"?: string,"p_page_size"?: number,"p_rating"?: string,"p_search"?: string }; Returns: {
              "aircraft_access": string,"bio": string,"certificates": (string)[],"display_name": string,"flying_interests": string,"home_airport": string,"photo_available": boolean,"pilot_designation": Database["public"]['Enums']["pilot_designation"],"ratings": (string)[],"user_id": string
            }[]
                           },
"lock_photo_owner":
{ Args: { "owner": string }; Returns: boolean
                           },
"mark_notification_read":
{ Args: { "p_notification_id": string }; Returns: Json
                           },
"mark_profile_photo_ready":
{ Args: { "reservation_id": string }; Returns: Json
                           },
"prepare_invitation_send_proof":
{ Args: { "p_attempt_id": string,"p_expected_version": number,"p_requester_id": string,"p_secret_digest": string,"p_subject_id": string,"p_transport": string }; Returns: Json
                           },
"profile_labels_valid":
{ Args: { "labels": (string)[] }; Returns: boolean
                           },
"read_invitation_confirmation_transport":
{ Args: { "p_lookup_digest": string,"p_origin": string }; Returns: Json
                           },
"read_password_recovery":
{ Args: { "p_digest": string,"p_email": string,"p_origin": string,"p_session_id": string,"p_subject": string }; Returns: Json
                           },
"read_verified_invitation_setup":
{ Args: { "p_email": string,"p_origin": string,"p_session_id": string,"p_setup_digest": string,"p_subject": string }; Returns: Json
                           },
"reconcile_invitation_send":
{ Args: { "p_attempt_id": string,"p_expected_version": number,"p_outcome": string,"p_requester_id": string,"p_subject_id": string }; Returns: Json
                           },
"record_invitation_password":
{ Args: { "p_email": string,"p_expected_version": number,"p_invitation_id": string,"p_operation_id": string,"p_origin": string,"p_session_id": string,"p_setup_authorization_id": string,"p_setup_digest": string,"p_subject": string }; Returns: Json
                           },
"record_invitation_send_outcome":
{ Args: { "p_attempt_id": string,"p_error_code": string,"p_expected_version": number,"p_outcome": string,"p_subject_id": string }; Returns: Json
                           },
"record_password_recovery":
{ Args: { "p_digest": string,"p_email": string,"p_origin": string,"p_session_id": string,"p_subject": string }; Returns: Json
                           },
"record_verified_invitation_setup":
{ Args: { "p_attempt_id": string,"p_email": string,"p_expected_version": number,"p_invitation_id": string,"p_origin": string,"p_resume_digest": string,"p_session_id": string,"p_setup_digest": string,"p_subject": string,"p_transport": string }; Returns: Json
                           },
"redeem_invitation":
{ Args: { "p_email": string,"p_expected_version": number,"p_invitation_id": string,"p_origin": string,"p_session_id": string,"p_setup_authorization_id": string,"p_setup_digest": string,"p_subject": string }; Returns: Json
                           },
"release_invitation_password":
{ Args: { "p_email": string,"p_expected_version": number,"p_invitation_id": string,"p_operation_id": string,"p_origin": string,"p_session_id": string,"p_setup_authorization_id": string,"p_setup_digest": string,"p_subject": string }; Returns: Json
                           },
"remove_profile_photo":
{ Args: Record<PropertyKey, never>; Returns: Json
                           },
"request_has_deleted_pilot":
{ Args: { "p_request_id": string }; Returns: boolean
                           },
"reserve_invitation_resend":
{ Args: { "p_expected_version": number,"p_invitation_id": string,"p_operation_id": string,"p_requester_id": string }; Returns: Json
                           },
"reserve_invitation_send":
{ Args: { "p_operation_id": string,"p_recipient_email": string,"p_requester_id": string }; Returns: Json
                           },
"reserve_profile_photo":
{ Args: Record<PropertyKey, never>; Returns: Json
                           },
"send_conversation_message":
{ Args: { "p_body": string,"p_conversation_id": string,"p_message_id": string }; Returns: Json
                           },
"submit_flight_interest":
{ Args: { "p_flight_id": string,"p_introductory_note"?: string }; Returns: Json
                           },
"submit_report":
{ Args: { "p_reason": string,"p_report_id": string,"p_target_id": string,"p_target_type": string }; Returns: Json
                           },
"withdraw_flight_request":
{ Args: { "p_flight_id": string,"p_request_id": string }; Returns: Json
                           }
          }
          Enums: {
            "flight_request_status": "pending"|"accepted"|"declined"|"withdrawn"|"cancelled","flight_status": "open"|"cancelled"|"completed","flight_visibility": "NETWORK"|"PRIVATE","invitation_send_kind": "initial"|"resend","invitation_send_outcome": "started"|"accepted"|"rejected"|"unknown","invitation_send_resolution": "accepted"|"rejected","invitation_status": "pending_issuance"|"issued"|"setup_verified"|"password_established"|"redeemed"|"revoked"|"superseded","member_role": "member"|"admin","membership_status": "active"|"disabled","pilot_designation": "student"|"licensed"
          }
          CompositeTypes: {
            [_ in never]: never
          }
        }
}

type DatabaseWithoutInternals = Omit<Database, '__InternalSupabase'>

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
  ? (DefaultSchema["Tables"] & DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
      Row: infer R
    }
    ? R
    : never
  : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
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
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never
> = DefaultSchemaEnumNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
  ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
  : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never
> = PublicCompositeTypeNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
  ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
  : never

export const Constants = {
  "public": {
          Enums: {
            "flight_request_status": ["pending", "accepted", "declined", "withdrawn", "cancelled"],"flight_status": ["open", "cancelled", "completed"],"flight_visibility": ["NETWORK", "PRIVATE"],"invitation_send_kind": ["initial", "resend"],"invitation_send_outcome": ["started", "accepted", "rejected", "unknown"],"invitation_send_resolution": ["accepted", "rejected"],"invitation_status": ["pending_issuance", "issued", "setup_verified", "password_established", "redeemed", "revoked", "superseded"],"member_role": ["member", "admin"],"membership_status": ["active", "disabled"],"pilot_designation": ["student", "licensed"]
          }
        }
} as const
