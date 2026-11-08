import type { ReactNode } from "react";
import { ui } from "../../../shared/lib/ui";

type PageHeaderProps = {
    backTo: string;
    backLabel: string;
    title: string;
    description?: string;
    children?: ReactNode;
};

export function StoreHeader({
    title,
    description,
    children,
}: PageHeaderProps) {
    return (
        <header>
            <h1 className={ui.title}>{title}</h1>

            {description && <p>{description}</p>}

            {children && (
                <div className="flex flex-wrap gap-3">
                    {children}
                </div>
            )}
        </header>
    );
}
