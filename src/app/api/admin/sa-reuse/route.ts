export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { CdpClient } from "@coinbase/cdp-sdk";

// BigInt-safe JSON
function safeJson(data: any, status = 200) {
  const body = JSON.stringify(data, (_, v) => (typeof v === "bigint" ? v.toString() : v));
  return new NextResponse(body, { status, headers: { "content-type": "application/json" } });
}
const ok = (d: any, s = 200) => safeJson(d, s);
const noauth = () => ok({ ok: false, error: "unauthorized" }, 401);

// 只允许 base / base-sepolia
function resolveNetwork(input?: string | null) {
  const n = (input || "").trim().toLowerCase();
  return n === "base-sepolia" ? "base-sepolia" : "base";
}

/**
 * 复用旧地址：从 SDK 获取 SmartAccount 实例，然后发送 UO 触发部署
 * GET /api/admin/sa-reuse?token=ADMIN_TOKEN&address=0xe659...eBB[&network=base|base-sepolia]
 *
 * 依赖：
 * - ADMIN_TOKEN
 * - CDP_API_KEY_NAME
 * - CDP_API_KEY_PRIVATE_KEY
 * - CDP_OWNER_EOA_ADDRESS  // 你的 Seller EOA（== 当初创建这个 SA 的 Owner）
 * - SMART_ACCOUNT_ADDRESS  // 可选，没传 address 时用
 * - NETWORK                // 可选，默认 base
 */
export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const token = req.headers.get("x-admin-token") ?? url.searchParams.get("token");
  if (token !== process.env.ADMIN_TOKEN) return noauth();

  const address = (url.searchParams.get("address") || process.env.SMART_ACCOUNT_ADDRESS || "").trim();
  if (!address) return ok({ ok: false, error: "missing smart account address" }, 400);

  const ownerAddress = process.env.CDP_OWNER_EOA_ADDRESS;
  if (!ownerAddress) return ok({ ok: false, error: "missing CDP_OWNER_EOA_ADDRESS" }, 400);

  const network = resolveNetwork(url.searchParams.get("network") || process.env.NETWORK || "base");

  // 统一 0 金额十六进制；data 必须 "0x"
  const tx = { to: ownerAddress as `0x${string}`, value: "0x0", data: "0x" };

  try {
    const cdp: any = new CdpClient({
      apiKeyName: process.env.CDP_API_KEY_NAME!,
      privateKey: process.env.CDP_API_KEY_PRIVATE_KEY!,
    });

    // 1) 从 SDK 拿“实例”（不要自己拼）
    //    大多数版本都支持 getSmartAccount；有的需要 network 才能取到具备方法的实例
    let sa: any = null;
    if (cdp?.evm?.getSmartAccount) {
      try {
        sa = await cdp.evm.getSmartAccount({ address, network });
      } catch {
        sa = await cdp.evm.getSmartAccount({ address });
      }
    }

    const debug: any = {
      address,
      owner: ownerAddress,
      network,
      gotInstance: !!sa,
    };

    if (!sa) {
      // 最后兜底：退化为最小对象（某些版本也可用），但优先建议上面这条
      sa = { address, owner: { address: ownerAddress } };
      debug.fallbackMinimalObject = true;
    }

    const hasObjSend = typeof sa?.sendUserOperation === "function";
    const hasObjWait = typeof sa?.waitForUserOperation === "function";
    const hasCdpSend = typeof cdp?.evm?.sendUserOperation === "function";
    const hasCdpWait = typeof cdp?.evm?.waitForUserOperation === "function";
    Object.assign(debug, { hasObjSend, hasObjWait, hasCdpSend, hasCdpWait });

    // 2) 依次尝试 3 种形状，哪个成功用哪个
    // —— 2.1 实例方法 + calls
    if (hasObjSend) {
      try {
        const res = await sa.sendUserOperation({ network, calls: [tx] });
        const userOpHash = res?.userOpHash;
        const receipt = hasObjWait
          ? await sa.waitForUserOperation({ userOpHash })
          : hasCdpWait
          ? await cdp.evm.waitForUserOperation({ smartAccount: sa, userOpHash })
          : null;

        return ok({
          ok: receipt?.status === "complete",
          deployed: receipt?.status === "complete",
          smartAccount: address,
          owner: ownerAddress,
          network,
          userOpHash,
          debug: { ...debug, method: "sa.sendUserOperation(calls[])" },
        });
      } catch (e: any) {
        debug.try1Error = String(e?.message || e);
      }
    }

    // —— 2.2 cdp.evm + calls
    if (hasCdpSend) {
      try {
        const res = await cdp.evm.sendUserOperation({ smartAccount: sa, network, calls: [tx] });
        const userOpHash = res?.userOpHash;
        const receipt = hasCdpWait
          ? await cdp.evm.waitForUserOperation({ smartAccount: sa, userOpHash })
          : hasObjWait
          ? await sa.waitForUserOperation({ userOpHash })
          : null;

        return ok({
          ok: receipt?.status === "complete",
          deployed: receipt?.status === "complete",
          smartAccount: address,
          owner: ownerAddress,
          network,
          userOpHash,
          debug: { ...debug, method: "cdp.evm.sendUserOperation(calls[])" },
        });
      } catch (e: any) {
        debug.try2Error = String(e?.message || e);
      }
    }

    // —— 2.3 cdp.evm + transactions（某些旧版字段名不同）
    if (hasCdpSend) {
      try {
        const res = await cdp.evm.sendUserOperation({ smartAccount: sa, network, transactions: [tx] });
        const userOpHash = res?.userOpHash;
        const receipt = hasCdpWait
          ? await cdp.evm.waitForUserOperation({ smartAccount: sa, userOpHash })
          : hasObjWait
          ? await sa.waitForUserOperation({ userOpHash })
          : null;

        return ok({
          ok: receipt?.status === "complete",
          deployed: receipt?.status === "complete",
          smartAccount: address,
          owner: ownerAddress,
          network,
          userOpHash,
          debug: { ...debug, method: "cdp.evm.sendUserOperation(transactions[])" },
        });
      } catch (e: any) {
        debug.try3Error = String(e?.message || e);
      }
    }

    // 三种都失败
    return ok({
      ok: false,
      smartAccount: address,
      owner: ownerAddress,
      network,
      error:
        "All variants failed. See debug.try1Error/try2Error/try3Error for details (SDK shape mismatch).",
      debug,
      next:
        "主网请确保该 SA 余额 ≥ 0.015–0.02 Base ETH，或在 Coinbase Developer Portal 开启 Gas Sponsorship。",
    });
  } catch (e: any) {
    return ok({
      ok: false,
      smartAccount: address,
      owner: ownerAddress,
      network,
      error: String(e?.message || e),
    });
  }
}
