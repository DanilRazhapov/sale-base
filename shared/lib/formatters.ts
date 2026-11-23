export const date = (value: string | null) => (value ? new Date(value).toLocaleString("ru-RU") : "—");

export const money = (value: number) =>
    value.toLocaleString("ru-RU", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
    });

export function previousPriceLabel(salePrice: number, catalogPrice: number | null) {
    const priceAtSync = catalogPrice === null ? "не задана" : `${money(catalogPrice)} сом`;
    return `Продано по прежней цене — ${money(salePrice)} сом за ед. Цена при синхронизации — ${priceAtSync}.`;
}
