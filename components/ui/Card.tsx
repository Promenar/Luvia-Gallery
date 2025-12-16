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
    const baseStyles = "bg-surface-primary border border-border-default rounded-xl overflow-hidden transition-all duration-300";

    // Conditional styles
    const hoverStyles = hover ? "hover:shadow-lg dark:hover:shadow-none hover:border-gray-300 dark:hover:border-gray-600" : "";
    const interactiveStyles = interactive ? "cursor-pointer active:scale-[0.98]" : "";
    const activeStyles = active ? "ring-2 ring-primary-500 border-primary-500" : "shadow-sm";

    return (
        <div
            className={`${baseStyles} ${hoverStyles} ${interactiveStyles} ${activeStyles} ${className}`}
            {...props}
        >
            {children}
        </div>
    );
};
