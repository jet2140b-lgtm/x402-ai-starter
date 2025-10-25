export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { CdpClient } from "@coinbase/cdp-sdk";
import { parseEther } from "viem";

const ok = (d: any, s = 200) => NextResponse.json(d, { status: s });
const noauth = () => ok({ ok: false, error: "unauthorized" }, 401);

export async function GET(req: NextRequest) {
  const token = req.headers.get("x-admin-token") ?? new URL(req.url).searchParams.get("token");
  if (token !== process.env.ADMIN_TOKEN) return noauth();

  const address =
    new URL(req.url).searchParams.get("address") ||
    process.env.SMART_ACCOUNT_ADDRESS; // 也可放在环境变量里统一管理
  if (!address) return ok({ ok: false, error: "missing smart account address" }, 400);

  const network = process.env.NETWORK || "base-mainnet";

  try {
    const cdp = new CdpClient({
      apiKeyName: process.env.CDP_API_KEY_NAME!,
      privateKey: process.env.CDP_API_KEY_PRIVATE_KEY!,
    });

    // 只部署：直接用地址发一个 0 ETH 自转的 UO
    const sendRes = await cdp.evm.sendUserOperation({
      smartAccountAddress: address,
      network,
      calls: [{ to: address as `0x${string}`, value: parseEther("0"), data: "0x" }],
    });

    const receipt = await cdp.evm.waitForUserOperation({
      smartAccountAddress: address,
      userOpHash: sendRes.userOpHash,
    });

    return ok({
      ok: receipt.status === "complete",
      smartAccount: address,
      userOpHash: sendRes.userOpHash,
      deployed: receipt.status === "complete",
    });
  } catch (err: any) {
    return ok({ ok: false, smartAccount: address, error: String(err) }, 200);
  }
}
