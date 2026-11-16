import { ui } from "../../shared/lib/ui";
import { kindName, money } from "../lib/cashierFormat";
import type { CartKind } from "../lib/cashierCart";
import type { CashierPOSProps } from "./types";
import type { CashierPOSState } from "./useCashierPOS";
import { useEffect, useRef, useState } from "react";

type Props = Pick<CashierPOSState, "lines" | "kind" | "ownShift" | "locked" | "changeKind" | "add"> &
    Pick<CashierPOSProps, "snapshot">;

const operationKinds: CartKind[] = ["sale", "receipt", "writeoff"];

function ProductImage({ imageKey }: { imageKey?: string | null }) {
    const ownerOrigin = import.meta.env.VITE_OWNER_APP_URL?.trim() ||
        (import.meta.env.DEV ? "http://localhost:5174" : "");
    const src = imageKey && ownerOrigin
        ? new URL(`/api/product-image?key=${encodeURIComponent(imageKey)}`, ownerOrigin).href
        : null;
    const [failedSrc, setFailedSrc] = useState<string | null>(null);

    return (
        <span className="pos-product-placeholder" aria-hidden="true">
            {src && failedSrc !== src ? (
                <img
                    src={src}
                    alt=""
                    className="pos-product-image"
                    loading="lazy"
                    decoding="async"
                    onError={() => setFailedSrc(src)}
                />
            ) : (
                <svg
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                >
                    <path d="m12 3 9 4.5v9L12 21l-9-4.5v-9L12 3Z" />
                    <path d="M3 7.5 12 12l9-4.5M12 12v9M7.5 5.25l9 4.5" />
                </svg>
            )}
        </span>
    );
}

export function CashierCatalog({ lines, kind, ownShift, locked, changeKind, add, snapshot }: Props) {
    const [category, setCategory] = useState("all");
    const [search, setSearch] = useState("");
    const categoriesRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const element = categoriesRef.current;
        if (!element) return;
        const strip = element;
        const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
        let wheelFrame = 0;
        let reelFrame = 0;
        let target = strip.scrollLeft;
        let lastFrame = 0;

        function animateWheel(time: number) {
            const elapsed = Math.min(time - lastFrame, 64);
            lastFrame = time;
            const remaining = target - strip.scrollLeft;
            if (Math.abs(remaining) < 1) {
                strip.scrollLeft = target;
                wheelFrame = 0;
                return;
            }
            strip.scrollLeft += remaining * (1 - Math.exp(-elapsed / 75));
            wheelFrame = requestAnimationFrame(animateWheel);
        }

        function updateReel() {
            reelFrame = 0;
            const mobile = window.matchMedia("(width < 600px)").matches;
            for (const button of strip.querySelectorAll<HTMLButtonElement>(".ui-button")) {
                const offset = mobile
                    ? Math.max(
                          -1.5,
                          Math.min(
                              1.5,
                              (button.offsetLeft + button.offsetWidth / 2 - strip.scrollLeft - strip.clientWidth / 2) /
                                  Math.max(1, button.offsetWidth),
                          ),
                      )
                    : 0;
                button.style.setProperty("--reel-offset", String(offset));
                button.style.setProperty("--reel-distance", String(Math.abs(offset)));
                button.style.zIndex = String(10 - Math.round(Math.abs(offset) * 4));
            }
        }

        function scheduleReel() {
            if (!reelFrame) reelFrame = requestAnimationFrame(updateReel);
        }

        function stopWheel() {
            cancelAnimationFrame(wheelFrame);
            wheelFrame = 0;
        }

        function scrollCategories(event: WheelEvent) {
            if (event.ctrlKey || event.shiftKey || Math.abs(event.deltaX) >= Math.abs(event.deltaY)) {
                stopWheel();
                return;
            }
            const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? strip.clientWidth : 1;
            if (!wheelFrame) target = strip.scrollLeft;
            target = Math.max(0, Math.min(strip.scrollWidth - strip.clientWidth, target + event.deltaY * unit));
            if (Math.abs(target - strip.scrollLeft) < 1) return;
            event.preventDefault();
            if (reducedMotion.matches) {
                stopWheel();
                strip.scrollLeft = target;
            } else if (!wheelFrame) {
                lastFrame = performance.now();
                wheelFrame = requestAnimationFrame(animateWheel);
            }
        }

        const resizeObserver = new ResizeObserver(scheduleReel);
        const mutationObserver = new MutationObserver(scheduleReel);
        resizeObserver.observe(strip);
        mutationObserver.observe(strip, { childList: true });
        strip.addEventListener("wheel", scrollCategories, { passive: false });
        strip.addEventListener("scroll", scheduleReel, { passive: true });
        strip.addEventListener("pointerdown", stopWheel, { passive: true });
        scheduleReel();
        return () => {
            stopWheel();
            cancelAnimationFrame(reelFrame);
            resizeObserver.disconnect();
            mutationObserver.disconnect();
            strip.removeEventListener("wheel", scrollCategories);
            strip.removeEventListener("scroll", scheduleReel);
            strip.removeEventListener("pointerdown", stopWheel);
        };
    }, []);
    const categories = snapshot.categories ?? [];
    const filtered = snapshot.products.filter(
        (product) =>
            (category === "all" ||
                (category === "none" ? product.category_id === null : String(product.category_id) === category)) &&
            product.name.toLocaleLowerCase().includes(search.toLocaleLowerCase()),
    );
    return (
        <section className="pos-catalog" aria-label="Каталог товаров">
            <div className="pos-operation-tabs" role="group" aria-label="Тип операции">
                {operationKinds.map((value) => (
                    <button
                        className={ui.button}
                        key={value}
                        disabled={locked}
                        aria-pressed={kind === value}
                        onClick={() => changeKind(value)}
                    >
                        {kindName[value]}
                    </button>
                ))}
            </div>
            <label className="pos-search">
                <span className="sr-only">Поиск товара по названию</span>
                <input
                    className={ui.input}
                    type="search"
                    placeholder="Поиск товара по названию"
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                />
            </label>
            <div ref={categoriesRef} className="pos-categories" role="group" aria-label="Категории">
                <button className={ui.button} aria-pressed={category === "all"} onClick={() => setCategory("all")}>
                    Все
                </button>
                {categories.map((item) => (
                    <button
                        className={ui.button}
                        key={item.id}
                        title={item.name}
                        aria-pressed={category === String(item.id)}
                        onClick={() => setCategory(String(item.id))}
                    >
                        {item.name}
                    </button>
                ))}
                {(category === "none" || snapshot.products.some((product) => product.category_id === null)) && (
                    <button
                        className={ui.button}
                        aria-pressed={category === "none"}
                        onClick={() => setCategory("none")}
                    >
                        Без категории
                    </button>
                )}
            </div>
            <div className="pos-catalog-scroll">
                {filtered.length > 0 ? (
                    <div className="pos-product-grid">
                        {filtered.map((product) => {
                            const selected = lines.find((line) => line.product_id === product.id);
                            const unavailable = kind !== "receipt" && Number(product.stock ?? 0) <= 0;
                            return (
                                <button
                                    className={ui.buttonBase + " pos-product"}
                                    key={product.id}
                                    disabled={
                                        locked ||
                                        !ownShift ||
                                        unavailable ||
                                        (kind === "sale" && product.price === null)
                                    }
                                    onClick={() => add(product)}
                                >
                                    <span className="pos-product-media">
                                        <ProductImage imageKey={product.image_key} />
                                        <span
                                            className="pos-product-quantity"
                                            key={selected?.quantity || "+"}
                                            data-selected={!!selected}
                                            aria-hidden="true"
                                        >
                                            {selected?.quantity || "+"}
                                        </span>
                                    </span>
                                    <strong title={product.name}>{product.name}</strong>
                                    <span className="pos-product-price">
                                        {product.price === null
                                            ? "Цена не задана"
                                            : `${money(Number(product.price))} / ${product.unit ?? "шт"}`}
                                    </span>
                                    <span className="pos-product-stock">
                                        {unavailable
                                            ? "Нет в наличии"
                                            : `Остаток: ${Number(product.stock ?? 0).toLocaleString("ru-RU")} ${product.unit ?? "шт"}`}
                                    </span>
                                    {selected && <span className="sr-only">В документе: {selected.quantity}</span>}
                                </button>
                            );
                        })}
                    </div>
                ) : (
                    <p className="empty-state">
                        {search ? "Товары не найдены." : "В этой категории пока нет товаров."}
                    </p>
                )}
            </div>
        </section>
    );
}
