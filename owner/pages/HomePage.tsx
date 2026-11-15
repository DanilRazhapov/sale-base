import { useEffect, useState } from "react";
import { Link, useOutletContext } from "react-router-dom";
import { ui } from "../../shared/lib/ui";
import { useOwnerSession } from "../auth/session";
import type { OwnerLayoutContext } from "../layouts/OwnerLayout";
import { supabase } from "../lib/supabase";
import { dashboardMoney, type DashboardData } from "../lib/dashboard";
import { RevenueChart } from "../components/dashboard/RevenueChart";
import { CategoryChart } from "../components/dashboard/CategoryChart";

function DashboardResults({ storeId, days }: { storeId: string; days: number }) {
    const [result, setResult] = useState<{ data: DashboardData | null; error: string }>({ data: null, error: "" });

    useEffect(() => {
        let active = true;
        async function load() {
            try {
                const { data, error } = await supabase.rpc("get_owner_dashboard", {
                    p_store_id: storeId || null, p_days: days,
                });
                if (error || !data) throw error ?? new Error("Empty dashboard");
                if (active) setResult({ data: data as DashboardData, error: "" });
            } catch {
                if (active) setResult({ data: null, error: "Не удалось загрузить аналитику. Проверьте подключение и нажмите «Обновить»." });
            }
        }
        void load();
        return () => { active = false; };
    }, [storeId, days]);

    if (result.error) return <p className="ui-error" role="alert">{result.error}</p>;
    if (!result.data) return <div className="dashboard-loading" role="status" aria-live="polite">
        <span className="dashboard-loading-dot" aria-hidden="true" />Загружаем аналитику…
    </div>;

    const data = result.data;
    return (
        <>
            <div className="dashboard-results">
                <div className="dashboard-summary">
                    <section className="dashboard-kpis" aria-label="Итоги выбранного периода">
                        <article><span>Выручка</span><strong>{dashboardMoney(data.revenue)}</strong><small>За выбранный период</small></article>
                        <article><span>Продажи</span><strong>{data.sales_count.toLocaleString("ru-RU")}</strong><small>Чеки и отдельные продажи</small></article>
                        <article><span>Средняя продажа</span><strong>{dashboardMoney(data.sales_count ? data.revenue / data.sales_count : 0)}</strong><small>Выручка на одну продажу</small></article>
                    </section>
                    {data.sales_count === 0 && <p className="dashboard-no-sales" role="status">За этот период продаж пока нет. Выберите другой период или магазин.</p>}
                </div>
                <div className="dashboard-charts">
                    <RevenueChart daily={data.daily} />
                    <CategoryChart categories={data.categories} />
                </div>
            </div>
            <div className="dashboard-footnote">
                <p>Дни рассчитаны по времени Бишкека. Учитываются продажи, поступившие на сервер. Категории соответствуют текущему каталогу.</p>
                <span>Обновлено: {new Date(data.updated_at).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Bishkek" })}</span>
            </div>
        </>
    );
}

export default function HomePage() {
    const { owner } = useOwnerSession();
    const { stores, isLoadingStores, storesError } = useOutletContext<OwnerLayoutContext>();
    const [storeId, setStoreId] = useState("");
    const [days, setDays] = useState(30);
    const [revision, setRevision] = useState(0);
    const availableStoreId = stores.some((store) => store.id === storeId) ? storeId : "";

    return (
        <main className={`${ui.page} dashboard-page`}>
            <div className="dashboard-container">
                <header className="dashboard-heading">
                    <div><span className={ui.eyebrow}>КАБИНЕТ ВЛАДЕЛЬЦА</span>
                        <h1 className={ui.title}>Обзор бизнеса</h1>
                        <p>Выручка и продажи ваших магазинов</p>
                    </div>
                    <button type="button" className="ui-button-base button-secondary" onClick={() => setRevision((value) => value + 1)}
                        disabled={isLoadingStores || !!storesError || !stores.length}>Обновить</button>
                </header>
                <section className="dashboard-filters" aria-label="Фильтры аналитики">
                    <label htmlFor="dashboard-store">Магазин
                        <select id="dashboard-store" className={ui.input} value={availableStoreId}
                            disabled={isLoadingStores || !!storesError || !stores.length} onChange={(event) => setStoreId(event.target.value)}>
                            <option value="">Все магазины</option>
                            {stores.map((store) => <option key={store.id} value={store.id}>{store.name}</option>)}
                        </select>
                    </label>
                    <fieldset><legend>Период</legend><div className="dashboard-periods">
                        {[7, 30, 90].map((period) => <button key={period} type="button" aria-pressed={days === period}
                            onClick={() => setDays(period)}>{period} дней</button>)}
                    </div></fieldset>
                    <span className="dashboard-timezone">Asia/Bishkek · UTC+6</span>
                </section>
                {isLoadingStores ? <p className="dashboard-loading" role="status">Загружаем магазины…</p>
                    : storesError ? <p className="ui-error" role="alert">{storesError}</p>
                    : !stores.length ? <section className="dashboard-panel dashboard-empty-chart">
                        <h2>Начните с первого магазина</h2><p>Здесь появятся выручка и распределение продаж по категориям.</p>
                        <Link to="/store/new" className="ui-button-base button-link-primary">Создать магазин</Link>
                    </section>
                    : <DashboardResults key={`${owner?.user.id}:${availableStoreId}:${days}:${revision}`} storeId={availableStoreId} days={days} />}
            </div>
        </main>
    );
}
