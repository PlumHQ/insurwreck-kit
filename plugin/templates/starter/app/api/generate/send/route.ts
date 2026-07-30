import { NextResponse } from "next/server";
import { getResend, FROM } from "@/lib/resend";

export async function POST(request: Request) {
  const { to, subject, body } = (await request.json()) as { to: string; subject: string; body: string };

  if (!to || !subject || !body) {
    return NextResponse.json({ error: "to, subject, and body are required" }, { status: 400 });
  }

  const resend = getResend();
  if (!resend) {
    return NextResponse.json({ error: "Email isn't configured — run npm run setup." }, { status: 500 });
  }

  const { data, error } = await resend.emails.send({
    from: FROM,
    to,
    subject,
    text: body,
  });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 502 });
  }

  return NextResponse.json({ id: data?.id });
}
