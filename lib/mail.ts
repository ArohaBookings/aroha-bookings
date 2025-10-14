// lib/mail.ts
import nodemailer from "nodemailer";

type MailOpts = {
  to: string;
  subject: string;
  html: string;
};

export async function sendMail(opts: MailOpts) {
  const transporter = nodemailer.createTransport(process.env.EMAIL_SERVER!);
  await transporter.sendMail({
    from: process.env.EMAIL_FROM || "Aroha Calls <no-reply@arohacalls.com>",
    to: opts.to,
    subject: opts.subject,
    html: opts.html,
  });
}
