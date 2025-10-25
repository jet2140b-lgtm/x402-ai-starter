export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { CdpClient } from "@coinbase/cdp-sdk";

const ok = (data: any, status = 200) => NextResponse.json(data, { status });
const noauth = () => ok({ ok: false, error: "unauthorized" }, 401);

export async function GET(req: NextRequest) {
  const token = req.headers.get("x-admin-token") ?? new URL(req.url).searchParams.get("token");
  if (token !== process.env.ADMIN_TOKEN) return noauth();

  try {
    const cdp = new CdpClient({
      apiKeyName: process.env.CDP_API_KEY_NAME!,
      privateKey: process.env.CDP_API_KEY_PRIVATE_KEY!,
    });

    const evm: any = (cdp as any).evm;
    if (!evm) return ok({ ok: false, error: "cdp.evm is undefined. Check @coinbase/cdp-sdk version." }, 500);

    // 1) 解析/准备 Owner（必须）
    let ownerId: string | undefined = process.env.CDP_OWNER_EOA_ID || undefined;
    let ownerAddress: string | undefined = process.env.CDP_OWNER_EOA_ADDRESS || undefined;

    // 如果只给了 address，尝试找回 id（部分 API 需要 id）
    if (!ownerId && ownerAddress && evm.accounts?.list) {
      try {
        const list = await evm.accounts.list();
        const hit = list?.find((a: any) => a?.address?.toLowerCase() === ownerAddress!.toLowerCase());
        if (hit?.id) ownerId = hit.id;
      } catch {}
    }

    // 如果一个都没配，先创建一个 EOA 当 Owner
    if (!ownerId && !ownerAddress) {
      const eoa = await (evm.createAccount ? evm.createAccount() : evm.accounts.create());
      ownerId = eoa.id;
      ownerAddress = eoa.address;
    }

    // 2) 创建 Smart Account（兼容多种 SDK 版本/参数名）
    let account: any | null = null;

    // 新版：evm.smartWallets.createAccount({ ownerAccountId / ownerAddress })
    if (evm.smartWallets?.createAccount) {
      try {
        account = await evm.smartWallets.createAccount(
          ownerId ? { ownerAccountId: ownerId } : { ownerAddress }
        );
      } catch (e) {
        // 有的版本只接受另一种字段名，换一种再试
        if (!account) {
          account = await evm.smartWallets.createAccount(
            ownerAddress ? { ownerAddress } : { ownerAccountId: ownerId }
          );
        }
      }
    }
    // 旧版：evm.createSmartAccount({ ... })
    else if (evm.createSmartAccount) {
      try {
        account = await evm.createSmartAccount(
          ownerId ? { ownerAccountId: ownerId } : { ownerAddress }
        );
      } catch (e) {
        if (!account) {
          account = await evm.createSmartAccount(
            ownerAddress ? { ownerAddress } : { ownerAccountId: ownerId }
          );
        }
      }
    }
    // 兜底：某些分支挂在 evm.accounts
    else if (evm.accounts?.createSmartAccount) {
      account = await evm.accounts.createSmartAccount(
        ownerId ? { ownerAccountId: ownerId } : { ownerAddress }
      );
    } else {
      return ok(
        {
          ok: false,
          error:
            "SDK 中未找到创建 Smart Account 的方法。请升级 @coinbase/cdp-sdk 到最新；通常为 evm.smartWallets.createAccount 或 evm.createSmartAccount。",
        },
        500
      );
    }

    return ok({
      ok: true,
      type: "smart-account",
      address: account?.address ?? null,
      id: account?.id ?? null,
      ownerAddress,
      ownerId,
      hint: "到 Developer Platform → Wallets → EVM Smart account 标签页应能看到该地址。",
    });
  } catch (err: any) {
    console.error(err);
    return ok({ ok: false, error: String(err) }, 500);
  }
}
