import { sendMail } from "@/lib/mail";
import { sendSMS } from "@/lib/sms";
import { resolveEmailIdentity } from "@/lib/emailIdentity";

type ReminderInput = {
  orgId: string;
  orgName: string;
  timezone: string;
  startsAt: Date;
  customerName: string;
  customerEmail?: string | null;
  customerPhone?: string | null;
  orgAddress?: string | null;
  orgPhone?: string | null;
  manageUrl?: string | null;
  bookingUrl?: string | null;
};

function fmtLocal(date: Date, tz: string) {
  return new Intl.DateTimeFormat("en-NZ", {
    timeZone: tz,
    weekday: "short",
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function buildEmailLayout(input: {
  title: string;
  body: string;
  orgName: string;
  orgAddress?: string | null;
  orgPhone?: string | null;
  supportEmail?: string;
  manageUrl?: string | null;
  bookingUrl?: string | null;
  footerText?: string;
}) {
  const contactLines = [
    input.orgAddress ? `Address: ${input.orgAddress}` : null,
    input.orgPhone ? `Phone: ${input.orgPhone}` : null,
    input.supportEmail ? `Support: ${input.supportEmail}` : null,
  ].filter(Boolean);

  const actionUrl = input.manageUrl || input.bookingUrl || "";
  return `
  <div style="font-family:Arial,sans-serif;background:#f4f5f7;padding:24px">
    <div style="max-width:600px;margin:0 auto;background:#ffffff;border-radius:12px;padding:24px;border:1px solid #e5e7eb">
      <h2 style="margin:0 0 12px 0;color:#111827">${input.title}</h2>
      <div style="color:#374151;font-size:14px;line-height:1.6">${input.body}</div>
      ${actionUrl ? `<p style="margin-top:16px"><a href="${actionUrl}" style="color:#059669;text-decoration:none;font-weight:bold">Manage your booking</a></p>` : ""}
      <div style="margin-top:20px;padding-top:16px;border-top:1px solid #e5e7eb;color:#6b7280;font-size:12px">
        <div>${input.orgName}</div>
        ${contactLines.map((line) => `<div>${line}</div>`).join("")}
        <div style="margin-top:8px">${input.footerText || "You’re receiving this message because you booked with us."}</div>
      </div>
    </div>
  </div>
  `;
}

export async function sendReminderEmail(input: ReminderInput) {
  if (!input.customerEmail) return;
  const when = fmtLocal(input.startsAt, input.timezone);
  const identity = await resolveEmailIdentity(input.orgId, input.orgName);
  await sendMail({
    to: input.customerEmail,
    subject: `Reminder: ${input.orgName} appointment`,
    from: `${identity.fromName} <${process.env.EMAIL_FROM?.match(/<(.+)>/)?.[1] || "no-reply@arohacalls.com"}>`,
    replyTo: identity.replyTo,
    html: buildEmailLayout({
      title: `Upcoming appointment with ${input.orgName}`,
      body: `Hi ${input.customerName},<br/><br/>This is a reminder of your appointment on <strong>${when}</strong>.`,
      orgName: input.orgName,
      orgAddress: input.orgAddress,
      orgPhone: input.orgPhone,
      manageUrl: input.manageUrl,
      bookingUrl: input.bookingUrl,
      footerText: identity.footerText,
      supportEmail: identity.supportEmail,
    }),
  });
}

export async function sendReminderSMS(input: ReminderInput) {
  if (!input.customerPhone) return;
  const when = fmtLocal(input.startsAt, input.timezone);
  await sendSMS(input.customerPhone, `Reminder: ${input.orgName} on ${when}.`);
}

export async function sendFollowUpEmail(input: ReminderInput) {
  if (!input.customerEmail) return;
  const identity = await resolveEmailIdentity(input.orgId, input.orgName);
  await sendMail({
    to: input.customerEmail,
    subject: `Thanks for visiting ${input.orgName}`,
    from: `${identity.fromName} <${process.env.EMAIL_FROM?.match(/<(.+)>/)?.[1] || "no-reply@arohacalls.com"}>`,
    replyTo: identity.replyTo,
    html: buildEmailLayout({
      title: `Thank you for visiting ${input.orgName}`,
      body: `Hi ${input.customerName},<br/><br/>Thanks for your visit. If you have a moment, we’d love your feedback.`,
      orgName: input.orgName,
      orgAddress: input.orgAddress,
      orgPhone: input.orgPhone,
      manageUrl: input.manageUrl,
      bookingUrl: input.bookingUrl,
      footerText: identity.footerText,
      supportEmail: identity.supportEmail,
    }),
  });
}

export async function sendFollowUpSMS(input: ReminderInput) {
  if (!input.customerPhone) return;
  await sendSMS(input.customerPhone, `Thanks for visiting ${input.orgName}. We’d love your feedback.`);
}

export async function sendBookingConfirmationEmail(input: ReminderInput & { serviceName?: string | null }) {
  if (!input.customerEmail) return;
  const when = fmtLocal(input.startsAt, input.timezone);
  const identity = await resolveEmailIdentity(input.orgId, input.orgName);
  await sendMail({
    to: input.customerEmail,
    subject: `Booking confirmed — ${input.orgName}`,
    from: `${identity.fromName} <${process.env.EMAIL_FROM?.match(/<(.+)>/)?.[1] || "no-reply@arohacalls.com"}>`,
    replyTo: identity.replyTo,
    html: buildEmailLayout({
      title: `Booking confirmed`,
      body: `Hi ${input.customerName},<br/><br/>Your ${input.serviceName || "appointment"} is confirmed for <strong>${when}</strong>.`,
      orgName: input.orgName,
      orgAddress: input.orgAddress,
      orgPhone: input.orgPhone,
      manageUrl: input.manageUrl,
      bookingUrl: input.bookingUrl,
      footerText: identity.footerText,
      supportEmail: identity.supportEmail,
    }),
  });
}

export async function sendRescheduleEmail(input: ReminderInput & { serviceName?: string | null }) {
  if (!input.customerEmail) return;
  const when = fmtLocal(input.startsAt, input.timezone);
  const identity = await resolveEmailIdentity(input.orgId, input.orgName);
  await sendMail({
    to: input.customerEmail,
    subject: `Booking rescheduled — ${input.orgName}`,
    from: `${identity.fromName} <${process.env.EMAIL_FROM?.match(/<(.+)>/)?.[1] || "no-reply@arohacalls.com"}>`,
    replyTo: identity.replyTo,
    html: buildEmailLayout({
      title: `Your booking was rescheduled`,
      body: `Hi ${input.customerName},<br/><br/>Your ${input.serviceName || "appointment"} is now set for <strong>${when}</strong>.`,
      orgName: input.orgName,
      orgAddress: input.orgAddress,
      orgPhone: input.orgPhone,
      manageUrl: input.manageUrl,
      bookingUrl: input.bookingUrl,
      footerText: identity.footerText,
      supportEmail: identity.supportEmail,
    }),
  });
}

export async function sendCancellationEmail(input: ReminderInput & { serviceName?: string | null }) {
  if (!input.customerEmail) return;
  const when = fmtLocal(input.startsAt, input.timezone);
  const identity = await resolveEmailIdentity(input.orgId, input.orgName);
  await sendMail({
    to: input.customerEmail,
    subject: `Booking cancelled — ${input.orgName}`,
    from: `${identity.fromName} <${process.env.EMAIL_FROM?.match(/<(.+)>/)?.[1] || "no-reply@arohacalls.com"}>`,
    replyTo: identity.replyTo,
    html: buildEmailLayout({
      title: `Booking cancelled`,
      body: `Hi ${input.customerName},<br/><br/>Your ${input.serviceName || "appointment"} on <strong>${when}</strong> has been cancelled.`,
      orgName: input.orgName,
      orgAddress: input.orgAddress,
      orgPhone: input.orgPhone,
      manageUrl: input.manageUrl,
      bookingUrl: input.bookingUrl,
      footerText: identity.footerText,
      supportEmail: identity.supportEmail,
    }),
  });
}
