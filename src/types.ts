import type { SVGAttributes } from "react";

/** Union of every available illustration name (auto-generated from SVG sources). */
export type IllustrationName =
  | "AddDocuments"
  | "AppDisabled"
  | "ClockingCode"
  | "Configured"
  | "ConnexionError"
  | "Create"
  | "Credentials"
  | "EditUser"
  | "Email"
  | "EmailReceived"
  | "Empty"
  | "ForbiddenAccess"
  | "GeofencingAccess"
  | "GeofencingUnavailable"
  | "InitializeNfcBadge"
  | "Landing"
  | "OnboardingClockingIn"
  | "OnboardingConnexion"
  | "OnboardingSettings"
  | "SendCode"
  | "Sent"
  | "SessionInactive"
  | "SessionTimeout"
  | "Shield"
  | "Site"
  | "WarningClock";

/** Available illustration categories. */
export type IllustrationCategory = never;

export interface IllustrationProps
  extends Omit<SVGAttributes<SVGSVGElement>, "width" | "height"> {
  /**
   * Rendered width in pixels. Defaults to the illustration's natural width.
   * If only width is set, height scales proportionally.
   */
  width?: number | string;
  /**
   * Rendered height in pixels. Defaults to the illustration's natural height.
   * If only height is set, width scales proportionally.
   */
  height?: number | string;
  /** Additional CSS class. */
  className?: string;
  /** Accessible label. If omitted, illustration is decorative (aria-hidden). */
  "aria-label"?: string;
}
