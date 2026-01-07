import React, { HTMLAttributes } from 'react';

interface CardProps extends HTMLAttributes<HTMLDivElement> {
    hover?: boolean;
    interactive?: boolean;
    active?: boolean;
}

export const Card: React.FC<CardProps> = ({
    children,
    className = '',
    hover = true,
    interactive = false,
    active = false,
    ...props
}) => {
    const baseStyles = "glass-1 rounded-xl overflow-hidden transition-all duration-300 shadow-glow";

    // Conditional styles
    const hoverStyles = hover ? "hover:-translate-y-0.5 hover:shadow-[0_14px_36px_rgba(0,0,0,0.25)] hover:border-border-glow" : "";
    const interactiveStyles = interactive ? "cursor-pointer active:scale-[0.99]" : "";
    const activeStyles = active ? "ring-2 ring-accent-500/50 border-border-glow" : "";

    return (
        <div
            className={`${baseStyles} ${hoverStyles} ${interactiveStyles} ${activeStyles} ${className}`}
            {...props}
        >
            {children}
        </div>
    );
};
