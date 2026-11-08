export const money = (value: number) =>
    value.toLocaleString("ru-RU", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
    });
export const kindName = {
    sale: "Продажа",
    receipt: "Приход",
    writeoff: "Списание",
};
