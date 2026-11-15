import { useState } from "react";
import { dashboardMoney, type DashboardData } from "../../lib/dashboard";

const colors = ["#ddef9a", "#e5ddf7", "#242329", "#bca8df", "#a6b86b", "#92949b"];

export function CategoryChart({ categories }: Pick<DashboardData, "categories">) {
    const [selected, setSelected] = useState<number | null>(null);
    const entries = categories.filter((category) => category.revenue > 0);
    const total = entries.reduce((sum, entry) => sum + entry.revenue, 0);
    const active = selected === null ? null : entries[selected];
    const percentage = (revenue: number) => new Intl.NumberFormat("ru-RU", {
        style: "percent", maximumFractionDigits: 1,
    }).format(revenue / total);
    const circumference = 2 * Math.PI * 78;
    const segments = entries.map((entry, index) => ({
        ...entry,
        offset: entries.slice(0, index).reduce((sum, previous) => sum + previous.revenue, 0) / total * circumference,
    }));

    return (
        <section className="dashboard-panel dashboard-chart-card" aria-labelledby="category-chart-title">
            <div className="dashboard-panel-heading"><div>
                <h2 id="category-chart-title">Продажи по категориям</h2><p>Доля выручки от проданных товаров</p>
            </div></div>
            {total > 0 ? <>
                <div className="dashboard-donut-wrap">
                    <svg viewBox="0 0 200 200" className="dashboard-donut" role="group"
                        aria-label="Доля выручки по категориям. Наведите на сектор или выберите его клавишей Tab.">
                        {segments.map((entry, index) => <circle key={index} cx="100" cy="100" r="78" fill="none"
                            stroke={colors[index % colors.length]} strokeWidth={selected === index ? 28 : 22}
                            strokeDasharray={`${entry.revenue / total * circumference} ${circumference}`}
                            strokeDashoffset={-entry.offset} transform="rotate(-90 100 100)"
                            opacity={selected !== null && selected !== index ? 0.35 : 1}
                            tabIndex={0} role="img" aria-label={`${entry.name}: ${percentage(entry.revenue)}`}
                            onFocus={() => setSelected(index)} onBlur={() => setSelected(null)}
                            onClick={() => setSelected(index)}
                            onPointerEnter={() => setSelected(index)} onPointerLeave={() => setSelected(null)}>
                            <title>{entry.name}: {percentage(entry.revenue)}</title>
                        </circle>)}
                    </svg>
                    <div className="dashboard-donut-center" aria-live="polite">
                        <span>{active?.name ?? "Всего за период"}</span>
                        <strong>{active ? percentage(active.revenue) : dashboardMoney(total)}</strong>
                    </div>
                </div>
            </> : <div className="dashboard-empty-chart"><span aria-hidden="true">◌</span><p>Пока нет выручки по категориям</p><small>Диаграмма появится после первых продаж.</small></div>}
        </section>
    );
}
