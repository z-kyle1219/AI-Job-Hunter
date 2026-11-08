import { useEffect, useState } from "react";
import Top from "../components/Top";
import Band from "../components/Band";
import { useProfile } from "../store";
import {
  ApiError,
  createOrder,
  deliverOrder,
  getOrderHistory,
  listProducts,
  payOrder,
  type Order,
  type Product,
  type QuotaLine,
} from "../api";
import type { Route } from "../App";

function priceText(product: Product): string {
  const major = product.price_cents / 100;
  return `¥${Number.isInteger(major) ? major : major.toFixed(2)}`;
}

function idempotencyKey(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return `report-${crypto.randomUUID()}`;
  return `report-${Date.now()}`;
}

export default function Purchase({ go }: { go: (r: Route) => void }) {
  const { profile, user, unlocked, setUnlocked, interview, setOrderId } = useProfile();
  const [product, setProduct] = useState<Product | null>(null);
  const [order, setOrder] = useState<Order | null>(null);
  const [quota, setQuota] = useState<QuotaLine | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const userId = user?.id ?? profile.backendUserId ?? null;

  useEffect(() => {
    let cancelled = false;
    setState("loading");
    void (async () => {
      try {
        const products = await listProducts();
        if (cancelled) return;
        // 报告解锁走面试这个商品；目录里没有就退回第一个，至少价格是真的
        const picked =
          products.find((item) => item.grants === "interview") ?? products[0] ?? null;
        setProduct(picked);
        setState("ready");

        if (userId) {
          try {
            const history = await getOrderHistory(userId);
            if (!cancelled) setQuota(history.interview);
          } catch {
            // 订单历史读不到不影响下单，只是少一行余额
          }
        }
      } catch (err) {
        if (cancelled) return;
        setNotice(err instanceof ApiError ? err.message : (err as Error).message);
        setState("error");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [userId]);

  async function buy() {
    if (!product || busy) return;
    if (!userId) {
      setNotice("请先登录：订单要挂在一个真实账户上，才能算「买了什么」。");
      return;
    }

    setBusy(true);
    setNotice(null);
    let warning: string | null = null;
    try {
      const created = await createOrder({
        userId,
        productCode: product.code,
        quantity: 1,
        idempotencyKey: idempotencyKey(),
      });
      const paid = await payOrder(created.id);
      setOrder(paid);
      setOrderId(paid.id);

      // 交付记录：把这场面试挂到这笔订单上，额度也从这里扣
      if (interview?.sessionId) {
        try {
          await deliverOrder(paid.id, interview.sessionId);
        } catch (err) {
          // 已交付 / 额度用完：订单本身已经支付，不阻断解锁
          if (!(err instanceof ApiError && err.status === 409)) throw err;
          warning = `支付成功，但交付记录没写：${err.message}`;
          setNotice(warning);
        }
      }

      setUnlocked(true);
      if (!warning) go("report");
    } catch (err) {
      setNotice(
        err instanceof ApiError ? `下单失败（${err.status}）：${err.message}` : (err as Error).message
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="shell" id="main">
      <Top onHome={() => go("home")} back={{ label: "返回报告", onClick: () => go("report") }} />

      <main className="page">
        <div className="eyebrow">完整报告 · 一次购买</div>
        <h1 className="h1 mt-16">解锁完整面试报告</h1>
        <p className="lead">判定只是结论。引用的原话、缺口和改法，都在完整报告里。</p>

        <div className="buy mt-32">
          <div>
            <div className="buy-price num">
              {state === "loading" ? "—" : product ? priceText(product) : "—"}
            </div>
            <div className="buy-unit">
              {product ? `/ ${product.unit} · ${product.name}` : "价目表读取中"}
            </div>

            <div className="qr" aria-label="演示支付，未接入真实渠道">
              <span>{order?.status === "paid" ? "已支付" : "演示支付"}</span>
            </div>

            <button
              className="pill solid mt-24"
              type="button"
              disabled={busy || state !== "ready"}
              onClick={() => (unlocked ? go("report") : void buy())}
            >
              {unlocked ? "已解锁，回到报告 →" : busy ? "正在下单……" : "购买并解锁 →"}
            </button>
            <p className="small mt-8">
              {unlocked
                ? "这一份已经解锁，不需要重复购买。"
                : "演示环境：下单后立即用 simulated 渠道支付，不产生真实扣款。"}
            </p>
            {quota && (
              <p className="small mt-8">
                剩余面试次数 · {quota.remaining} 次（已用 {quota.used} / 共 {quota.granted}）
              </p>
            )}
            {order && (
              <p className="small mt-8">
                订单 {order.id.slice(0, 8)} · {order.status === "paid" ? "已支付" : order.status} ·{" "}
                {(order.amount_cents / 100).toFixed(2)} {order.currency}
              </p>
            )}
            {notice && (
              <p className="small warn mt-8" role="alert">
                {notice}
              </p>
            )}
          </div>

          <ul className="buy-list">
            {(product?.features ?? [
              "每条要求引用的原话",
              "缺口说明：缺什么、下次怎么答",
              "逐项改法与练习清单",
            ]).map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </div>
      </main>

      <Band step={4} total={4} label="购买 · 完整报告" />
    </div>
  );
}
