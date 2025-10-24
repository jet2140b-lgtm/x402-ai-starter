// src/app/api/fetch/route.ts
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@coinbase/cdp-sdk";
import { parseUnits } from "viem/utils";

function getPayer(req: NextRequest): string {
  const b64 =
    req.headers.get("x-payment-response") ||
    req.headers.get("x-402-receipt") ||
    "";
  try {
    if (b64) {
      const j = JSON.parse(Buffer.from(b64, "base64").toString("utf8"));
      return j.payer || j.account || j.from || "";
    }
  } catch {}
  return new URL(req.url).searchParams.get("to") || "";
}

export async function GET(req: NextRequest) {
  const to = getPayer(req);
  if (!to) {
    return NextResponse.json({ error: "Missing payer address" }, { status: 400 });
  }

  const cdp = createClient({
    apiKeyName: process.env.CDP_API_KEY_ID!,
    privateKey: process.env.CDP_API_KEY_SECRET!,
    walletSecret: process.env.CDP_WALLET_SECRET!,
  });

  const token = process.env.X404_CONTRACT_ADDRESS!;
  const decimals = Number(process.env.X404_DECIMALS || "18");
  const perFetch = process.env.X404_PER_FETCH || "10000";
  const amount = parseUnits(perFetch, decimals);

  await cdp.transfers.sendErc20({ tokenAddress: token, to, amount });

  return NextResponse.json({ ok: true, to, sent: perFetch });
}
