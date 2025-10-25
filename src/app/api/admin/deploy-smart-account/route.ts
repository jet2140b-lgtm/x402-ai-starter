export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { CdpClient } from "@coinbase/cdp-sdk";
import { parseEther } from "viem";

// BigInt-safe JSON
function safeJson(data: any, status = 200) {
  const body = JSON.stringify(data, (_, v) => (typeof v === "bigint" ? v.toString() : v));
  return new NextResponse(body, { status, headers: { "content-type": "application/json" } });
}
const ok = (d: any, s = 200) => safeJson(d, s);
const noauth = () => ok({ ok: false, error: "unauthorized" }, 401);

// 仅允许 base / base-sepolia；其余全部改成 base
function resolveNetwork(input?: string | null) {
  const n = (input || "").trim().toLowerCase();
  return n === "base-sepolia" ? "base-sepolia" : "base";
}

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const token = req.headers.get("x-admin-token") ?? url.searchParams.get("token");
  if (token !== process.env.ADMIN_TOKEN) return noauth();

  const address = url.searchParams.get("address") || process.env.SMART_ACCOUNT_ADDRESS;
  if (!address) return ok({ ok: false, error: "missing smart account address" }, 400);

  const ownerAddress = process.env.CDP_OWNER_EOA_ADDRESS;
  if (!ownerAddress) return ok({ ok: false, error: "missing owner (CDP_OWNER_EOA_ADDRESS)" }, 400);

  // 允许用 query 覆盖：?network=base 或 base-sepolia
  const network = resolveNetwork(url.searchParams.get("network") || process.env.NETWORK || "base");

  try {
    const cdp: any = new CdpClient({
      apiKeyName: process.env.CDP_API_KEY_NAME!,
      privateKey: process.env.CDP_API_KEY_PRIVATE_KEY!,
    });

    const smartAccount = { address, owner: { address: ownerAddress } };

    const sendRes = await cdp.evm.sendUserOperation({
      smartAccount,
      network, // <- 只会是 "base" 或 "base-sepolia"
      calls: [{ to: ownerAddress as `0x${string}`, value: parseEther("0"), data: "0x" }],
    });

    const receipt = await cdp.evm.waitForUserOperation({
      smartAccount,
      userOpHash: sendRes.userOpHash,
    });

    return ok({
      ok: receipt?.status === "complete",
      deployed: receipt?.status === "complete",
      network, // 返回实际使用的网络名
      smartAccount: address,
      owner: ownerAddress,
      userOpHash: sendRes.userOpHash,
    });
  } catch (err: any) {
    return ok({
      ok: false,
      smartAccount: address,
      owner: ownerAddress,
      network,
      error: String(err?.message || err),
    });
  }
}
