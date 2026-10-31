import { useState, type FormEvent } from "react";
import { supabase } from "../../lib/supabase";
import { ui } from "../../lib/ui";
import type { Category, RunStoreAction } from "./types";

type Props = {
    storeId: string;
    categories: Category[];
    busy: boolean;
    runAction: RunStoreAction;
};

export function CategoryForm({ storeId, categories, busy, runAction }: Props) {
    const [categoryName, setCategoryName] = useState("");

    function createCategory(event: FormEvent<HTMLFormElement>) {
        event.preventDefault();
        void runAction(async () => {
            if (!categoryName.trim()) throw new Error("Введите название категории.");
            const { error } = await supabase.from("categories").insert({
                store_id: storeId,
                name: categoryName.trim(),
            });
            if (error) throw error;
            setCategoryName("");
        }, "Категория создана.");
    }

    return (
        <section className="store-section">
            <h2 className={ui.heading}>Категории</h2>
            <p>{categories.map((category) => category.name).join(" · ") || "Категорий пока нет."}</p>
            <ul className="my-4 space-y-2">
                {categories.map((category) => (
                    <li key={category.id} className="flex items-center justify-between gap-3">
                        <span>{category.name}</span>
                        <button
                            className={ui.button}
                            disabled={busy}
                            onClick={() => {
                                if (
                                    !window.confirm(
                                        "Удалить категорию «" + category.name + "»? Товары останутся без категории.",
                                    )
                                )
                                    return;
                                void runAction(async () => {
                                    const { error } = await supabase.rpc("remove_store_category", {
                                        p_store_id: storeId,
                                        p_category_id: category.id,
                                    });
                                    if (error) throw error;
                                }, "Категория удалена.");
                            }}
                        >
                            Удалить
                        </button>
                    </li>
                ))}
            </ul>
            <form onSubmit={createCategory}>
                <fieldset className={ui.fieldset} disabled={busy}>
                    <label className={ui.label}>
                        Новая категория
                        <input
                            className={ui.input}
                            required
                            maxLength={120}
                            value={categoryName}
                            onChange={(e) => setCategoryName(e.target.value)}
                        />
                    </label>
                    <button className={ui.button}>Добавить категорию</button>
                </fieldset>
            </form>
        </section>
    );
}
