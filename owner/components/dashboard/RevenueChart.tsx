import { useId, useState } from "react";
import { dashboardDay, dashboardMoney, type DashboardData } from "../../lib/dashboard";

export function RevenueChart({ daily }: Pick<DashboardData, "daily">) {
    const gradientId = useId();
    const [selected, setSelected] = useState<number | null>(null);
    const peak = Math.max(...daily.map((day) => day.revenue), 1);
    const width = 300, height = 190, left = 42, right = 12, top = 12, bottom = 28;
    const plotWidth = width - left - right, plotHeight = height - top - bottom;
    const x = (index: number) => left + (index * plotWidth) / Math.max(daily.length - 1, 1);
    const y = (revenue: number) => top + plotHeight * (1 - revenue / peak);
    const line = daily.map((day, index) => `${x(index)},${y(day.revenue)}`).join(" ");
    const selectedDay = daily[selected ?? daily.length - 1];
    const ticks = [0, Math.floor((daily.length - 1) / 2), daily.length - 1];

    return (
        <section className="dashboard-panel dashboard-chart-card" aria-labelledby="revenue-chart-title">
            <div className="dashboard-panel-heading">
                <div><h2 id="revenue-chart-title">Динамика выручки</h2><p>Продажи по дням · сом</p></div>
                <span className="dashboard-chart-badge">{daily.length} дней</span>
            </div>
            <div className="dashboard-chart-readout" aria-live="polite">
                <span>{selectedDay ? dashboardDay(selectedDay.date) : "Нет данных"}</span>
                <strong>{dashboardMoney(selectedDay?.revenue ?? 0)}</strong>
            </div>
            <svg className="dashboard-revenue-chart" viewBox={`0 0 ${width} ${height}`} role="img"
                aria-label="График дневной выручки. Используйте стрелки влево и вправо для выбора дня."
                tabIndex={0}
                onBlur={() => setSelected(null)}
                onKeyDown={(event) => {
                    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
                    event.preventDefault();
                    setSelected((index) => Math.max(0, Math.min(daily.length - 1,
                        (index ?? daily.length - 1) + (event.key === "ArrowLeft" ? -1 : 1))));
                }}>
                <defs><linearGradient id={gradientId} x1="0" x2="0" y1="0" y2="1">
                    <stop offset="0%" stopColor="var(--brand-soft)" stopOpacity="0.85" />
                    <stop offset="100%" stopColor="var(--brand-soft)" stopOpacity="0.08" />
                </linearGradient></defs>
                {[0, 0.5, 1].map((ratio) => (
                    <g key={ratio}>
                        <line x1={left} x2={width - right} y1={y(peak * ratio)} y2={y(peak * ratio)} className="dashboard-grid-line" />
                        <text x={left - 10} y={y(peak * ratio) + 4} textAnchor="end">
                            {new Intl.NumberFormat("ru-RU", { notation: "compact", maximumFractionDigits: 1 }).format(peak * ratio)}
                        </text>
                    </g>
                ))}
                {daily.length > 0 && <>
                    <polygon points={`${left},${y(0)} ${line} ${x(daily.length - 1)},${y(0)}`} fill={`url(#${gradientId})`} />
                    <polyline points={line} className="dashboard-revenue-line" />
                    {ticks.map((index) => <text key={index} x={x(index)} y={height - 8}
                        textAnchor={index === 0 ? "start" : index === daily.length - 1 ? "end" : "middle"}>
                        {dashboardDay(daily[index].date)}
                    </text>)}
                    {daily.map((day, index) => (
                        <rect key={day.date} x={x(index) - plotWidth / daily.length / 2} y={top}
                            width={plotWidth / daily.length + 1} height={plotHeight} fill="transparent"
                            onPointerMove={() => setSelected(index)} onPointerLeave={() => setSelected(null)}>
                            <title>{dashboardDay(day.date)}: {dashboardMoney(day.revenue)}</title>
                        </rect>
                    ))}
                    {selected !== null && <g pointerEvents="none">
                        <line x1={x(selected)} x2={x(selected)} y1={top} y2={y(0)} className="dashboard-guide-line" />
                        <circle cx={x(selected)} cy={y(daily[selected].revenue)} r="5" className="dashboard-chart-point" />
                    </g>}
                </>}
            </svg>
            <div className="sr-only"><table>
                    <caption className="sr-only">Выручка за каждый день выбранного периода</caption>
                    <thead><tr><th scope="col">Дата</th><th scope="col">Выручка</th></tr></thead>
                    <tbody>{daily.map((day) => <tr key={day.date}>
                        <th scope="row">{dashboardDay(day.date)}</th>
                        <td>{dashboardMoney(day.revenue)}</td>
                    </tr>)}</tbody>
                </table></div>
        </section>
    );
}
