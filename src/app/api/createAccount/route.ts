import { NextResponse } from "next/server";
import { CdpClient } from "@coinbase/cdp-sdk";

export async function GET() {
  try {
    const cdp = new CdpClient();
    const account = await cdp.evm.createAccount();
    return NextResponse.json({
      ok: true,
      address: account.address,
    });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ ok: false, error: String(err) });
  }
}
