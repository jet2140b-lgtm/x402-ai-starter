// src/app/api/fetch/route.ts
import { NextRequest, NextResponse } from "next/server";
import { CdpClient } from "@coinbase/cdp-sdk";
import { parseUnits } from "viem/utils";

function readPayer(req: NextRequest) {
  const b64 =
    req.headers.get("x-payment-response") ||
    req.headers.get("x-402-receipt") ||
    "";
  if (b64) {
    try {
      const j = JSON.parse(Buffer.from(b64, "base64").toString("utf8"));
      return j.payer || j.account || j.from || "";
    } catch {}
  }
  return new URL(req.url).searchParams.get("to") || "";
}

export async function GET(req: NextRequest) {
  const to = readPayer(req);
  if (!to)
    return NextResponse.json({ error: "Missing payer" }, { status: 400 });

  const cdp = new CdpClient({
    apiKeyName: process.env.CDP_API_KEY_NAME!,
    apiKeySecret: process.env.CDP_API_KEY_PRIVATE_KEY!,
    walletSecret: process.env.CDP_WALLET_SECRET!,
  });

  const token = process.env.X404_CONTRACT_ADDRESS!;
  const decimals = Number(process.env.X404_DECIMALS || "18");
  const amount = parseUnits(process.env.X404_PER_FETCH || "5000", decimals);

  await cdp.transfers.sendErc20({
    tokenAddress: token,
    to,
    amount,
  });

  return NextResponse.json({
    ok: true,
    sent: process.env.X404_PER_FETCH || "5000",
    to,
  });
}
