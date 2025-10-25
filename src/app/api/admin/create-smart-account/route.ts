export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { CdpClient } from "@coinbase/cdp-sdk";

const ok = (data: any, status = 200) => NextResponse.json(data, { status });
const noauth = () => ok({ ok: false, error: "unauthorized" }, 401);

export async function GET(req: NextRequest) {
  const token =
    req.headers.get("x-admin-token") ??
    new URL(req.url).searchParams.get("token");
  if (token !== process.env.ADMIN_TOKEN) return noauth();

  try {
    const cdp = new CdpClient({
      apiKeyName: process.env.CDP_API_KEY_NAME!,
      privateKey: process.env.CDP_API_KEY_PRIVATE_KEY!,
    });

    const evm: any = (cdp as any).evm;
    if (!evm) return ok({ ok: false, error: "cdp.evm is undefined" }, 500);

    // 1) 先准备 Owner（必要）
    let ownerId: string | undefined = process.env.CDP_OWNER_EOA_ID || undefined;
    let ownerAddress: string | undefined =
      process.env.CDP_OWNER_EOA_ADDRESS || undefined;

    if (!ownerId && !ownerAddress) {
      // 创建一个 EOA 作为 Owner（不同版本有 createAccount / accounts.create）
      const createEoa =
        evm.createAccount?.bind(evm) ?? evm.accounts?.create?.bind(evm.accounts);
      if (!createEoa) {
        return ok(
          { ok: false, error: "No EOA creator (evm.createAccount / evm.accounts.create) found." },
          500
        );
      }
      const eoa = await createEoa();
      ownerId = eoa?.id;
      ownerAddress = eoa?.address;
    }

    // 2) 创建 Smart Account（不同版本方法名不同）
    const createSmart =
      evm.smartWallets?.createAccount?.bind(evm.smartWallets) ??
      evm.createSmartAccount?.bind(evm) ??
      evm.accounts?.createSmartAccount?.bind(evm.accounts);

    if (!createSmart) {
      return ok(
        {
          ok: false,
          error:
            "No Smart Account creator found (evm.smartWallets.createAccount / evm.createSmartAccount / evm.accounts.createSmartAccount). Please upgrade @coinbase/cdp-sdk.",
        },
        500
      );
    }

    const arg =
      ownerId ? { ownerAccountId: ownerId } : ({ ownerAddress } as any);

    const raw = await createSmart(arg);

    // 3) 解析地址（兼容多种返回结构）
    const address =
      raw?.address ??
      raw?.smartAccount?.address ??
      raw?.data?.address ??
      raw?.result?.address ??
      null;
    const id =
      raw?.id ??
      raw?.smartAccount?.id ??
      raw?.data?.id ??
      raw?.result?.id ??
      null;

    // 4) 如果还是拿不到，尝试列出 Smart Accounts 取最近一个
    let finalAddress = address;
    let finalId = id;

    if (!finalAddress) {
      const listSmart =
        evm.smartWallets?.listAccounts?.bind(evm.smartWallets) ??
        evm.listSmartAccounts?.bind(evm) ??
        evm.accounts?.listSmartAccounts?.bind(evm.accounts);

      if (listSmart) {
        try {
          const list = await listSmart();
          // 取最后一个/第一个
          const last = Array.isArray(list) ? list[list.length - 1] : null;
          finalAddress =
            last?.address ?? last?.smartAccount?.address ?? finalAddress;
          finalId = last?.id ?? last?.smartAccount?.id ?? finalId;
        } catch (e) {
          // 列表失败就忽略
        }
      }
    }

    // 把原始返回也带回去，便于诊断
    return ok({
      ok: !!finalAddress,
      address: finalAddress,
      id: finalId,
      ownerId,
      ownerAddress,
      raw, // ← 关键：看到 SDK 实际返回结构
      hint:
        "若 address 仍为空，请把 raw 结构贴给我；也可升级 @coinbase/cdp-sdk@latest 后再试。",
    });
  } catch (err: any) {
    console.error(err);
    return ok({ ok: false, error: String(err) }, 500);
  }
}
