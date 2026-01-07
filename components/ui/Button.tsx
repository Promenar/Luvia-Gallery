import React, { ButtonHTMLAttributes } from 'react';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
    variant?: 'primary' | 'secondary' | 'ghost' | 'outline' | 'danger';
    size?: 'sm' | 'md' | 'lg';
    loading?: boolean;
    icon?: React.ReactNode;
}

export const Button: React.FC<ButtonProps> = ({
    children,
    variant = 'primary',
    size = 'md',
    loading = false,
    icon,
    className = '',
    disabled,
    ...props
}) => {
    const baseStyles = "inline-flex items-center justify-center rounded-full font-medium transition-all focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-accent-500/60 disabled:opacity-50 disabled:cursor-not-allowed backdrop-blur-sm";

    const variants = {
        primary: "bg-accent-500/80 hover:bg-accent-500 text-white border border-border-glow shadow-[0_10px_30px_rgba(69,181,255,0.35)]",
        secondary: "glass-1 text-text-primary border border-border-default hover:border-border-glow",
        ghost: "bg-transparent hover:bg-surface-tertiary/50 text-text-secondary hover:text-text-primary",
        outline: "bg-transparent border border-border-default text-text-primary hover:bg-surface-tertiary/60 hover:border-border-glow",
        danger: "bg-red-500/10 text-red-500 hover:bg-red-500/18 border border-red-500/30"
    };

    const sizes = {
        sm: "px-3 py-1.5 text-xs gap-1.5 min-h-[36px]",
        md: "px-4 py-2 text-sm gap-2 min-h-[42px]",
        lg: "px-5 py-2.5 text-base gap-2.5 min-h-[48px]"
    };

    return (
        <button
            className={`${baseStyles} ${variants[variant]} ${sizes[size]} ${className}`}
            disabled={disabled || loading}
            {...props}
        >
            {loading ? (
                <svg className="animate-spin -ml-1 mr-2 h-4 w-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                </svg>
            ) : icon ? (
                <span className="shrink-0">{icon}</span>
            ) : null}
            {children}
        </button>
    );
};
