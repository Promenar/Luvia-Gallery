import React, { InputHTMLAttributes } from 'react';

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
    error?: boolean;
    fullWidth?: boolean;
}

export const Input: React.FC<InputProps> = ({
    className = '',
    error = false,
    fullWidth = true,
    ...props
}) => {
    const baseStyles = "bg-surface-secondary text-text-primary placeholder-text-tertiary border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 transition-all";

    const stateStyles = error
        ? "border-red-300 focus:border-red-500 focus:ring-red-200"
        : "border-border-default focus:border-primary-500 focus:ring-primary-100 dark:focus:ring-primary-900/30";

    const widthStyles = fullWidth ? "w-full" : "";

    return (
        <input
            className={`${baseStyles} ${stateStyles} ${widthStyles} ${className}`}
            {...props}
        />
    );
};
