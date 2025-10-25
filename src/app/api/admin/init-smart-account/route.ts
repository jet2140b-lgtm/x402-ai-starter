export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { CdpClient } from "@coinbase/cdp-sdk";
import { parseEther } from "viem";

const ok = (d: any, s = 200) => NextResponse.json(d, { status: s });
const noauth = () => ok({ ok: false, error: "unauthorized" }, 401);

/**
 * 固定 Owner（CDP_OWNER_EOA_ADDRESS），生成“稳定” Smart Account 地址，
 * 若资金充足则同请求发一笔 0 ETH 自转的 UO 完成部署。
 *
 * GET /api/admin/init-smart-account?token=ADMIN_TOKEN
 */
export async function GET(req: NextRequest) {
  const token =
    req.headers.get("x-admin-token") ??
    new URL(req.url).searchParams.get("token");
  if (token !== process.env.ADMIN_TOKEN) return noauth();

  const ownerAddress = process.env.CDP_OWNER_EOA_ADDRESS;
  if (!ownerAddress) {
    return ok(
      { ok: false, error: "Missing CDP_OWNER_EOA_ADDRESS env" },
      400
    );
  }

  const network = process.env.NETWORK || "base-mainnet";

  try {
    const cdp = new CdpClient({
      apiKeyName: process.env.CDP_API_KEY_NAME!,
      privateKey: process.env.CDP_API_KEY_PRIVATE_KEY!,
    });

    // 1) 固定 Owner（只给 address 即可）
    const owner = { address: ownerAddress };

    // 2) 基于 Owner 生成 Smart Account（CREATE2，可预测地址）
    const smartAccount = await (cdp as any).evm.createSmartAccount({ owner });

    // 3) 试图直接部署：发一笔 0 ETH 自转 UO
    try {
      const sendRes = await (cdp as any).evm.sendUserOperation({
        smartAccount,                  // 传对象（SDK 需要）
        network,
        calls: [{ to: ownerAddress, value: parseEther("0"), data: "0x" }],
      });

      const receipt = await (cdp as any).evm.waitForUserOperation({
        smartAccount,
        userOpHash: sendRes.userOpHash,
      });

      return ok({
        ok: true,
        owner: { address: ownerAddress },
        smartAccount: { address: smartAccount.address },
        deployed: receipt?.status === "complete",
        userOpHash: sendRes.userOpHash,
        hint:
          receipt?.status === "complete"
            ? "✅ 已部署完成"
            : "已提交 UO，稍后再刷新 Portal。",
      });
    } catch (deployErr: any) {
      // 多半是没 gas：把地址返回给你去充值，再调用本接口一次即可
      return ok({
        ok: true,
        owner: { address: ownerAddress },
        smartAccount: { address: smartAccount.address },
        deployed: false,
        userOpError: String(deployErr),
        next:
          "请先向 smartAccount.address 转入 ≥0.01 Base ETH（或配置 Gas Sponsorship），再调用本接口一次以完成部署。",
      });
    }
  } catch (err: any) {
    return ok({ ok: false, error: String(err) }, 500);
  }
}
