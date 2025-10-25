export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { CdpClient } from "@coinbase/cdp-sdk";
import { parseEther } from "viem";

const ok = (d: any, s = 200) => NextResponse.json(d, { status: s });
const noauth = () => ok({ ok: false, error: "unauthorized" }, 401);

export async function GET(req: NextRequest) {
  const token = req.headers.get("x-admin-token") ?? new URL(req.url).searchParams.get("token");
  if (token !== process.env.ADMIN_TOKEN) return noauth();

  const ownerAddr = (process.env.CDP_OWNER_EOA_ADDRESS || "").toLowerCase();
  if (!ownerAddr) return ok({ ok: false, error: "Missing CDP_OWNER_EOA_ADDRESS env" }, 400);

  const network = process.env.NETWORK || "base-sepolia";

  try {
    const cdp: any = new CdpClient({
      apiKeyName: process.env.CDP_API_KEY_NAME!,
      privateKey: process.env.CDP_API_KEY_PRIVATE_KEY!,
    });

    // ① 从 CDP 拉取“账户对象”，而不是用裸地址
    //    大多数 SDK 版本没有 getAccount(by address) 方法；最稳妥是 list 后匹配
    const listAccounts =
      cdp?.evm?.accounts?.list?.bind(cdp.evm.accounts) ?? cdp?.evm?.listAccounts?.bind(cdp.evm);
    if (!listAccounts) {
      return ok({ ok: false, error: "SDK missing accounts.list API. Upgrade @coinbase/cdp-sdk." }, 500);
    }

    const all = await listAccounts();
    const owner = (Array.isArray(all?.accounts) ? all.accounts : all)?.find(
      (a: any) => a?.address?.toLowerCase() === ownerAddr
    );

    if (!owner) {
      return ok({
        ok: false,
        error:
          "Owner address not found in this CDP project. The CDP_OWNER_EOA_ADDRESS must be an EOA created under the SAME project.",
        hint:
          "Go to Developer Portal → Wallets → EVM EOA，确认该地址存在；或去掉该 env 让代码先创建一个新的 EOA 再重试。",
      }, 400);
    }

    // ② 基于“账户对象”创建 Smart Account（只生成 CREATE2 地址）
    const createSA =
      cdp?.evm?.createSmartAccount?.bind(cdp.evm) ??
      cdp?.evm?.smartWallets?.createAccount?.bind(cdp.evm.smartWallets);
    if (!createSA) {
      return ok({ ok: false, error: "SDK missing createSmartAccount API. Upgrade @coinbase/cdp-sdk." }, 500);
    }

    const smartAccount = await createSA({ owner }); // ← 关键：传“账户对象”，不是地址

    // ③ 发送首笔 UO 部署（用 smartAccount 对象）
    try {
      const sendUO =
        smartAccount?.sendUserOperation?.bind(smartAccount) ??
        cdp?.evm?.sendUserOperation?.bind(cdp.evm);

      if (!sendUO) {
        return ok({ ok: false, error: "SDK missing sendUserOperation API." }, 500);
      }

      const { userOpHash } = await sendUO({
        smartAccount,          // 传对象，内部会用到 owner.sign()
        network,
        calls: [{ to: owner.address as `0x${string}`, value: parseEther("0"), data: "0x" }],
      });

      const waitUO =
        smartAccount?.waitForUserOperation?.bind(smartAccount) ??
        cdp?.evm?.waitForUserOperation?.bind(cdp.evm);

      const receipt = await waitUO({ userOpHash, smartAccount });
      const deployed = receipt?.status === "complete";

      return ok({
        ok: true,
        network,
        owner: { address: owner.address, id: owner.id },
        smartAccount: { address: smartAccount.address, id: smartAccount.id ?? null },
        deployed,
        userOpHash,
        hint: deployed ? "✅ 已部署完成（Smart account 已在 Portal 可见）" : "已提交 UO，稍后再查。",
      });
    } catch (e: any) {
      // 主网若没 gas 或未启用赞助，这里会失败
      return ok({
        ok: true,
        network,
        owner: { address: owner.address, id: owner.id },
        smartAccount: { address: smartAccount.address, id: smartAccount.id ?? null },
        deployed: false,
        userOpError: String(e),
        next:
          network === "base-mainnet"
            ? "请先向 smartAccount.address 转 ≥0.01 Base ETH（或配置 Gas Sponsorship），再调用本接口完成部署。"
            : "若是 sepolia 仍失败，升级 @coinbase/cdp-sdk 后重试。",
      });
    }
  } catch (err: any) {
    return ok({ ok: false, error: String(err) }, 500);
  }
}
