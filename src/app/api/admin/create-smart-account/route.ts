export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { CdpClient } from "@coinbase/cdp-sdk";
import { parseEther } from "viem";

const ok = (d: any, s = 200) => NextResponse.json(d, { status: s });
const noauth = () => ok({ ok: false, error: "unauthorized" }, 401);

/**
 * 访问方式：
 *   GET /api/admin/create-smart-account?token=<ADMIN_TOKEN>
 *
 * 流程：
 *   1) 创建一个 EVM EOA 账户（Owner）
 *   2) 用 owner 对象创建 Smart Account（仅生成 CREATE2 地址）
 *   3) 发送一笔 “0 ETH 自转” 的 User Operation 在 Base 主网，让 Smart Account 真正部署
 *      —— 若你还没做 Gas 赞助，请先往 Smart Account 地址转入少量 Base ETH（~0.002）
 */
export async function GET(req: NextRequest) {
  const token =
    req.headers.get("x-admin-token") ??
    new URL(req.url).searchParams.get("token");
  if (token !== process.env.ADMIN_TOKEN) return noauth();

  try {
    const network = process.env.NETWORK || "base-mainnet"; // 和你线上一致
    const cdp = new CdpClient({
      apiKeyName: process.env.CDP_API_KEY_NAME!,
      privateKey: process.env.CDP_API_KEY_PRIVATE_KEY!,
    });

    // 1) 创建 Owner（EVM EOA）
    const owner = await cdp.evm.createAccount(); // 文档示例就是这样
    // 2) 基于 Owner 创建 Smart Account（先拿到 CREATE2 地址，但尚未部署）
    const smartAccount = await cdp.evm.createSmartAccount({ owner });

    // === 重要：部署 Smart Account（第一次 UO）===
    // 官方说明：主网需要资金或开启 Gas Sponsorship。否则这一步会因 gas 不足而失败。:contentReference[oaicite:2]{index=2}
    // 这里我们发一笔 0 ETH 到 owner 自己的“空调用”，只为触发部署。
    let userOpHash: string | undefined;
    try {
      const sendRes = await cdp.evm.sendUserOperation({
        smartAccount,            // 直接传对象，不是地址
        network,                 // base-mainnet / base-sepolia
        calls: [
          { to: owner.address, value: parseEther("0"), data: "0x" }
        ],
      });
      userOpHash = sendRes.userOpHash;

      // 等待 UO 上链完成（部署完成）
      const receipt = await cdp.evm.waitForUserOperation({
        smartAccountAddress: smartAccount.address,
        userOpHash,
      });

      return ok({
        ok: true,
        owner: { address: owner.address },
        smartAccount: { address: smartAccount.address },
        deployed: receipt.status === "complete",
        userOpHash,
        hint:
          receipt.status === "complete"
            ? "Smart Account 已部署，可在 Dashboard 的 Smart account 栏看到。"
            : "已提交 UO，稍后再刷新 Dashboard。",
      });
    } catch (deployErr: any) {
      // 多半是没 gas（Base 主网）或未开启 Paymaster/Gas Sponsorship
      return ok({
        ok: true,
        owner: { address: owner.address },
        smartAccount: { address: smartAccount.address },
        deployed: false,
        userOpError: String(deployErr),
        next:
          "请先向上面的 smartAccount.address 转入少量 Base ETH（~0.002），或在 CDP 配置 Gas Sponsorship，然后再调用本接口一次以完成部署。",
      }, 200);
    }
  } catch (err: any) {
    return ok({ ok: false, error: String(err) }, 500);
  }
}
