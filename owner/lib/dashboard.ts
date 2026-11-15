export type DashboardData = {
    revenue: number;
    sales_count: number;
    daily: { date: string; revenue: number }[];
    categories: { name: string; revenue: number }[];
    updated_at: string;
};

export const dashboardMoney = (value: number) =>
    `${new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 2 }).format(value)} сом`;

export const dashboardDay = (value: string) =>
    new Date(`${value}T00:00:00+06:00`).toLocaleDateString("ru-RU", {
        day: "numeric", month: "short", timeZone: "Asia/Bishkek",
    });
