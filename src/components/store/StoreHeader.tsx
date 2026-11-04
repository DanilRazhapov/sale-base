import type { ReactNode } from "react";
import { Link, NavLink } from "react-router-dom";
import { ui } from "../../lib/ui";
import type { Store } from "./types";

type PageHeaderProps = {
    store: Store;
    title: string;
    description?: string;
    children?: ReactNode;
};

export function StoreHeader({ store, title, description, children }: PageHeaderProps) {
    const storePath = `/store/${store.id}`;

    return (
        <header className="store-page-header">
            <div className="store-breadcrumb">
                <Link to="/">Магазины</Link>
                <span aria-hidden="true">/</span>
                <span>{store.name}</span>
            </div>
            <div className="store-page-heading">
                <div>
                    <h1 className={ui.title}>{title}</h1>
                    {description && <p>{description}</p>}
                </div>
                {children && <div className="store-page-actions">{children}</div>}
            </div>
            <nav className="store-tabs" aria-label="Разделы магазина">
                <NavLink to={storePath} end>
                    Обзор
                </NavLink>
                <NavLink to={`${storePath}/inventory`}>Товары</NavLink>
                <NavLink to={`${storePath}/stock`}>Остатки</NavLink>
            </nav>
        </header>
    );
}
