export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { CdpClient } from "@coinbase/cdp-sdk";
import { parseEther } from "viem";

function safeJson(data: any, status = 200) {
  const body = JSON.stringify(data, (_, v) => (typeof v === "bigint" ? v.toString() : v));
  return new NextResponse(body, { status, headers: { "content-type": "application/json" } });
}
const ok = (d: any, s = 200) => safeJson(d, s);
const noauth = () => ok({ ok: false, error: "unauthorized" }, 401);

function getCdpNetwork() {
  const raw = process.env.NETWORK || "base";
  return raw === "base" ? "base-mainnet" : raw; // base -> base-mainnet
}

/**
 * 固定 Owner（CDP_OWNER_EOA_ADDRESS），创建 SA（CREATE2 可预测地址）并尝试部署。
 * GET /api/admin/init-smart-account?token=ADMIN_TOKEN
 */
export async function GET(req: NextRequest) {
  const token = req.headers.get("x-admin-token") ?? new URL(req.url).searchParams.get("token");
  if (token !== process.env.ADMIN_TOKEN) return noauth();

  const ownerAddress = process.env.CDP_OWNER_EOA_ADDRESS;
  if (!ownerAddress) return ok({ ok: false, error: "Missing CDP_OWNER_EOA_ADDRESS env" }, 400);

  const network = getCdpNetwork();

  try {
    const cdp: any = new CdpClient({
      apiKeyName: process.env.CDP_API_KEY_NAME!,
      privateKey: process.env.CDP_API_KEY_PRIVATE_KEY!,
    });

    const owner = { address: ownerAddress };

    // 1) 创建 Smart Account（仅地址，可预测）
    const smartAccount = await cdp.evm.createSmartAccount({ owner });

    // 2) 试图直接部署：0 ETH 自转（主网需 SA 里有 gas；sepolia 有补贴）
    try {
      const sendRes = await cdp.evm.sendUserOperation({
        smartAccount,
        network,
        calls: [{ to: ownerAddress as `0x${string}`, value: parseEther("0"), data: "0x" }],
      });
      const receipt = await cdp.evm.waitForUserOperation({
        smartAccount,
        userOpHash: sendRes.userOpHash,
      });

      return ok({
        ok: true,
        owner: { address: ownerAddress },
        smartAccount: { address: smartAccount.address },
        deployed: receipt?.status === "complete",
        userOpHash: sendRes.userOpHash,
        network,
      });
    } catch (deployErr: any) {
      return ok({
        ok: true,
        owner: { address: ownerAddress },
        smartAccount: { address: smartAccount.address },
        deployed: false,
        userOpError: String(deployErr?.message || deployErr),
        next:
          network === "base-mainnet"
            ? "请先向 smartAccount.address 充 ≥0.015 Base ETH，再调本接口一次完成部署。"
            : "sepolia 一般可 0 成本完成部署，若失败请重试。",
        network,
      });
    }
  } catch (err: any) {
    return ok({ ok: false, error: String(err), network }, 500);
  }
}
