
export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[]

export type Database = {
  
  "public": {
          Tables: {
            "invitation_send_attempts": {
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
                },"memberships": {
                  Row: {
                    "created_at": string,"disabled_at": string | null,"disabled_reason": string | null,"role": Database["public"]['Enums']["member_role"],"status": Database["public"]['Enums']["membership_status"],"user_id": string
                  }
                  Insert: {
                    "created_at"?: string,"disabled_at"?: string | null,"disabled_reason"?: string | null,"role"?: Database["public"]['Enums']["member_role"],"status"?: Database["public"]['Enums']["membership_status"],"user_id": string
                  }
                  Update: {
                    "created_at"?: string,"disabled_at"?: string | null,"disabled_reason"?: string | null,"role"?: Database["public"]['Enums']["member_role"],"status"?: Database["public"]['Enums']["membership_status"],"user_id"?: string
                  }
                  Relationships: [
                    
                  ]
                }
          }
          Views: {
            [_ in never]: never
          }
          Functions: {
            "bind_invitation_send_subject":
{ Args: { "p_attempt_id": string,"p_expected_version": number,"p_requester_id": string,"p_subject_id": string }; Returns: Json
                           },
"record_invitation_send_outcome":
{ Args: { "p_attempt_id": string,"p_error_code": string,"p_expected_version": number,"p_outcome": string,"p_subject_id": string }; Returns: Json
                           },
"reserve_invitation_send":
{ Args: { "p_operation_id": string,"p_recipient_email": string,"p_requester_id": string }; Returns: Json
                           }
          }
          Enums: {
            "invitation_send_kind": "initial"|"resend","invitation_send_outcome": "started"|"accepted"|"rejected"|"unknown","invitation_send_resolution": "accepted"|"rejected","invitation_status": "pending_issuance"|"issued"|"setup_verified"|"password_established"|"redeemed"|"revoked"|"superseded","member_role": "member"|"admin","membership_status": "active"|"disabled"
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
            "invitation_send_kind": ["initial", "resend"],"invitation_send_outcome": ["started", "accepted", "rejected", "unknown"],"invitation_send_resolution": ["accepted", "rejected"],"invitation_status": ["pending_issuance", "issued", "setup_verified", "password_established", "redeemed", "revoked", "superseded"],"member_role": ["member", "admin"],"membership_status": ["active", "disabled"]
          }
        }
} as const
