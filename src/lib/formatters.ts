export const date = (value: string | null) => (value ? new Date(value).toLocaleString("ru-RU") : "—");

export const money = (value: number) =>
    value.toLocaleString("ru-RU", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
    });