// lib/booking/templates.ts
export type BookingTemplateKey =
  | "default"
  | "trades"
  | "hair_beauty"
  | "medical"
  | "dental"
  | "law"
  | "auto";

export type BookingPageContent = {
  headline: string;
  subheadline: string;
  tips: string[];
  trustBadges: string[];
};

export type BookingFieldKey =
  | "jobAddress"
  | "jobType"
  | "stylistGender"
  | "hairLength"
  | "visitReason"
  | "medicalConsent"
  | "matterType"
  | "legalUrgency"
  | "vehicleRego"
  | "vehicleMakeModel"
  | "vehicleIssue";

export type BookingPageConfig = {
  template: BookingTemplateKey;
  content: BookingPageContent;
  fields: Record<BookingFieldKey, boolean>;
};

export const BOOKING_TEMPLATE_OPTIONS: Array<{ key: BookingTemplateKey; label: string }> = [
  { key: "default", label: "Default" },
  { key: "trades", label: "Trades" },
  { key: "hair_beauty", label: "Hair & Beauty" },
  { key: "medical", label: "Medical" },
  { key: "dental", label: "Dental" },
  { key: "law", label: "Law" },
  { key: "auto", label: "Auto" },
];

export const BOOKING_FIELDS: Record<BookingFieldKey, { label: string; placeholder?: string }> = {
  jobAddress: { label: "Job address", placeholder: "Street address + suburb" },
  jobType: { label: "Job type", placeholder: "e.g., leak repair, new install" },
  stylistGender: { label: "Preferred stylist gender (optional)", placeholder: "No preference" },
  hairLength: { label: "Hair length (optional)", placeholder: "Short / Medium / Long" },
  visitReason: { label: "Reason for visit", placeholder: "Brief reason (no medical advice)" },
  medicalConsent: { label: "Consent", placeholder: "I consent to be contacted about this request" },
  matterType: { label: "Matter type", placeholder: "Family, property, employment, other" },
  legalUrgency: { label: "Urgency", placeholder: "Normal / urgent" },
  vehicleRego: { label: "Vehicle rego", placeholder: "ABC123" },
  vehicleMakeModel: { label: "Vehicle make/model", placeholder: "Toyota Corolla" },
  vehicleIssue: { label: "Issue type", placeholder: "Noise, service, brakes" },
};

export const BOOKING_TEMPLATES: Record<BookingTemplateKey, BookingPageConfig> = {
  default: {
    template: "default",
    content: {
      headline: "Book your next appointment in minutes",
      subheadline: "Choose a service, pick a time, and we will confirm by SMS.",
      tips: [
        "Instant confirmation and calendar reminders",
        "Reschedule easily from your confirmation email",
        "Times shown in your local timezone",
      ],
      trustBadges: ["Secure booking", "Local team", "Transparent pricing"],
    },
    fields: {
      jobAddress: false,
      jobType: false,
      stylistGender: false,
      hairLength: false,
      visitReason: false,
      medicalConsent: false,
      matterType: false,
      legalUrgency: false,
      vehicleRego: false,
      vehicleMakeModel: false,
      vehicleIssue: false,
    },
  },
  trades: {
    template: "trades",
    content: {
      headline: "Book a job visit without the back-and-forth",
      subheadline: "Tell us the job type and address so we can arrive prepared.",
      tips: [
        "We confirm by SMS within business hours",
        "Include photos in the notes if helpful",
        "We service the wider Auckland region",
      ],
      trustBadges: ["Licensed & insured", "Fixed-price quotes", "On-time arrivals"],
    },
    fields: {
      jobAddress: true,
      jobType: true,
      stylistGender: false,
      hairLength: false,
      visitReason: false,
      medicalConsent: false,
      matterType: false,
      legalUrgency: false,
      vehicleRego: false,
      vehicleMakeModel: false,
      vehicleIssue: false,
    },
  },
  hair_beauty: {
    template: "hair_beauty",
    content: {
      headline: "Reserve your chair with the right stylist",
      subheadline: "Share your preferences so we can match you perfectly.",
      tips: ["Consultation included", "Gentle on time and budget", "Bring reference photos"],
      trustBadges: ["Top-rated stylists", "Premium products", "Transparent timing"],
    },
    fields: {
      jobAddress: false,
      jobType: false,
      stylistGender: true,
      hairLength: true,
      visitReason: false,
      medicalConsent: false,
      matterType: false,
      legalUrgency: false,
      vehicleRego: false,
      vehicleMakeModel: false,
      vehicleIssue: false,
    },
  },
  medical: {
    template: "medical",
    content: {
      headline: "Book your appointment with care",
      subheadline: "Let us know the reason for your visit so we can prepare.",
      tips: [
        "No medical advice is given online",
        "We confirm within business hours",
        "Bring ID and a list of medications",
      ],
      trustBadges: ["Privacy-first", "Registered clinicians", "Careful follow-up"],
    },
    fields: {
      jobAddress: false,
      jobType: false,
      stylistGender: false,
      hairLength: false,
      visitReason: true,
      medicalConsent: true,
      matterType: false,
      legalUrgency: false,
      vehicleRego: false,
      vehicleMakeModel: false,
      vehicleIssue: false,
    },
  },
  dental: {
    template: "dental",
    content: {
      headline: "Book your dental visit with confidence",
      subheadline: "Tell us the reason for your visit so we can prioritize care.",
      tips: ["Emergency slots held daily", "Gentle and modern care", "We confirm quickly"],
      trustBadges: ["Gentle care", "Modern equipment", "Transparent pricing"],
    },
    fields: {
      jobAddress: false,
      jobType: false,
      stylistGender: false,
      hairLength: false,
      visitReason: true,
      medicalConsent: true,
      matterType: false,
      legalUrgency: false,
      vehicleRego: false,
      vehicleMakeModel: false,
      vehicleIssue: false,
    },
  },
  law: {
    template: "law",
    content: {
      headline: "Book a confidential consultation",
      subheadline: "Share the matter type and urgency to match the right adviser.",
      tips: ["Confidential by default", "Document checklist sent after booking", "Clear next steps"],
      trustBadges: ["Confidential", "Senior advisors", "Transparent scope"],
    },
    fields: {
      jobAddress: false,
      jobType: false,
      stylistGender: false,
      hairLength: false,
      visitReason: false,
      medicalConsent: false,
      matterType: true,
      legalUrgency: true,
      vehicleRego: false,
      vehicleMakeModel: false,
      vehicleIssue: false,
    },
  },
  auto: {
    template: "auto",
    content: {
      headline: "Book your vehicle service fast",
      subheadline: "Share your rego and issue so we can prep parts.",
      tips: ["Drop-off reminders sent by SMS", "Loan cars by request", "Transparent inspection notes"],
      trustBadges: ["Qualified technicians", "OEM parts", "Clear estimates"],
    },
    fields: {
      jobAddress: false,
      jobType: false,
      stylistGender: false,
      hairLength: false,
      visitReason: false,
      medicalConsent: false,
      matterType: false,
      legalUrgency: false,
      vehicleRego: true,
      vehicleMakeModel: true,
      vehicleIssue: true,
    },
  },
};

export function resolveBookingPageConfig(
  niche: string | null | undefined,
  data: Record<string, unknown>
): BookingPageConfig {
  const map: Record<string, BookingTemplateKey> = {
    TRADES: "trades",
    HAIR_BEAUTY: "hair_beauty",
    MEDICAL: "medical",
    DENTAL: "dental",
    LAW: "law",
    AUTO: "auto",
  };

  const baseKey = map[(niche || "").toUpperCase()] || "default";
  const override = (data.bookingPage as Partial<BookingPageConfig>) || {};
  const templateKey = (override.template as BookingTemplateKey) || baseKey;
  const base = BOOKING_TEMPLATES[templateKey] || BOOKING_TEMPLATES.default;

  const content = {
    ...base.content,
    ...(override.content || {}),
  } as BookingPageContent;

  const fields = {
    ...base.fields,
    ...(override.fields || {}),
  } as BookingPageConfig["fields"];

  return {
    template: templateKey,
    content: {
      headline: content.headline || base.content.headline,
      subheadline: content.subheadline || base.content.subheadline,
      tips: Array.isArray(content.tips) ? content.tips : base.content.tips,
      trustBadges: Array.isArray(content.trustBadges) ? content.trustBadges : base.content.trustBadges,
    },
    fields,
  };
}
