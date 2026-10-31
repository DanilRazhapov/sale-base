import { useState, type FormEvent } from "react";
import { supabase } from "../../lib/supabase";
import { ui } from "../../lib/ui";
import type { Category, Product, RunStoreAction } from "./types";

const emptyDraft = {
    name: "",
    category: "",
    unit: "шт",
    price: "",
    stock: "0",
};

type Props = {
    storeId: string;
    categories: Category[];
    editing: Product | null;
    busy: boolean;
    runAction: RunStoreAction;
    onClose: () => void;
};

export function ProductForm({ storeId, categories, editing: initialProduct, busy, runAction, onClose }: Props) {
    // Keep the version being edited even when the catalog refreshes in the background.
    // The parent changes the form key when another product is selected.
    const [editing] = useState(initialProduct);
    const [draft, setDraft] = useState(() =>
        editing
            ? {
                  name: editing.name,
                  category: String(editing.category_id ?? ""),
                  unit: editing.unit ?? "шт",
                  price: String(editing.price ?? 0),
                  stock: String(editing.stock ?? 0),
              }
            : emptyDraft,
    );

    function saveProduct(event: FormEvent<HTMLFormElement>) {
        event.preventDefault();
        void runAction(async () => {
            const { error } = await supabase.rpc("save_store_product", {
                p_store_id: storeId,
                p_product_id: editing?.id ?? null,
                p_updated_at: editing?.updated_at ?? null,
                p_name: draft.name.trim(),
                p_category_id: draft.category ? Number(draft.category) : null,
                p_unit: draft.unit.trim(),
                p_price: Number(draft.price),
                p_stock: Number(draft.stock),
            });
            if (error) throw error;
            onClose();
        }, "Товар сохранён.");
    }

    return (
        <section id="product-editor" className="product-editor">
            <h2 className={ui.heading}>{editing ? `Редактирование: ${editing.name}` : "Добавить товар"}</h2>
            <form onSubmit={saveProduct}>
                <fieldset
                    className={ui.fieldset + " !grid !grid-cols-1 sm:!grid-cols-2 [&_input]:w-full [&_select]:w-full"}
                    disabled={busy}
                >
                    <label className={ui.label + " sm:col-span-2"}>
                        Название
                        <input
                            className={ui.input}
                            required
                            maxLength={120}
                            value={draft.name}
                            onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                        />
                    </label>

                    <label className={ui.label}>
                        Категория
                        <select
                            className={ui.input}
                            value={draft.category}
                            onChange={(e) =>
                                setDraft({
                                    ...draft,
                                    category: e.target.value,
                                })
                            }
                        >
                            <option value="">Без категории</option>
                            {categories.map((category) => (
                                <option key={category.id} value={category.id}>
                                    {category.name}
                                </option>
                            ))}
                        </select>
                    </label>

                    <label className={ui.label}>
                        Единица измерения
                        <select
                            className={ui.input}
                            value={draft.unit}
                            onChange={(event) => {
                                setDraft({
                                    ...draft,
                                    unit: event.target.value,
                                });
                            }}
                        >
                            <option value="шт">Штука</option>
                            <option value="кг">Килограмм</option>
                            <option value="л">Литр</option>
                        </select>
                    </label>

                    <label className={ui.label}>
                        Цена за единицу
                        <input
                            className={ui.input}
                            type="number"
                            required
                            min="0"
                            max="9999999999.99"
                            step="0.01"
                            value={draft.price}
                            onChange={(e) =>
                                setDraft({
                                    ...draft,
                                    price: e.target.value,
                                })
                            }
                        />
                    </label>

                    <label className={ui.label}>
                        Остаток на складе ({draft.unit})
                        <input
                            className={ui.input}
                            type="number"
                            required
                            min="0"
                            max="99999999999.999"
                            step="0.001"
                            value={draft.stock}
                            onChange={(e) =>
                                setDraft({
                                    ...draft,
                                    stock: e.target.value,
                                })
                            }
                        />
                    </label>

                    <label
                        className={
                            ui.label + " product-image-field"
                        }
                    >
                        Изображение товара
                        <input
                            className={ui.input}
                            type="file"
                            accept="image/*"
                            aria-describedby="product-image-hint"
                        />
                        <span id="product-image-hint" className="text-sm font-normal text-muted">
                            Изображение пока не загружается и не сохраняется.
                        </span>
                    </label>
                    <div className="flex flex-wrap gap-3 sm:col-span-2">
                        <button className={ui.button + " button-primary"}>
                            {busy ? "Сохранение..." : editing ? "Сохранить изменения" : "Добавить товар"}
                        </button>

                        {editing && (
                            <button className={ui.button} type="button" onClick={onClose}>
                                Отмена
                            </button>
                        )}
                    </div>
                </fieldset>
            </form>

            {editing && (
                <button
                    className={ui.button + " button-soft-danger"}
                    disabled={busy}
                    onClick={() => {
                        if (!window.confirm("Удалить товар «" + editing.name + "»? История сохранится.")) return;
                        void runAction(async () => {
                            const { error } = await supabase.rpc("remove_store_product", {
                                p_store_id: storeId,
                                p_product_id: editing.id,
                            });
                            if (error) throw error;
                            onClose();
                        }, "Товар удалён.");
                    }}
                >
                    Удалить товар
                </button>
            )}
            <p>Количество на складе — это остаток. Его ручное изменение сохраняется в истории как корректировка.</p>
        </section>
    );
}
