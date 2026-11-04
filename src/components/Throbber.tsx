type ThrobberProps = {
    label?: string;
    className?: string;
};

export default function Throbber({ label = "Загрузка…", className = "" }: ThrobberProps) {
    return (
        <div className={`throbber ${className}`} role="status">
            <span className="brand-mark" aria-hidden="true" />
            <span className="throbber-progress" aria-hidden="true" />
            <span>{label}</span>
        </div>
    );
}
