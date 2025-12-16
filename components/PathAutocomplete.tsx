
import React, { useState, useEffect, useRef } from 'react';
import { Icons } from './ui/Icon';

interface PathAutocompleteProps {
    value: string;
    onChange: (val: string) => void;
    onAdd: () => void;
}

export const PathAutocomplete: React.FC<PathAutocompleteProps> = ({ value, onChange, onAdd }) => {
    const [suggestions, setSuggestions] = useState<string[]>([]);
    const [isOpen, setIsOpen] = useState(false);
    const wrapperRef = useRef<HTMLDivElement>(null);

    // Debounce fetching
    useEffect(() => {
        const timeoutId = setTimeout(async () => {
            if (!value) {
                setSuggestions([]);
                return;
            }

            // If value ends with slash or we are typing, try to list current directory
            // We assume the user is typing an absolute path.
            // If they type "/media/mov", we want to list contents of "/media" and filter by "mov"
            
            let lookupPath = value;
            if (!value.endsWith('/')) {
                const parts = value.split('/');
                parts.pop();
                lookupPath = parts.join('/') || '/';
            }

            try {
                const res = await fetch(`/api/fs/list?path=${encodeURIComponent(lookupPath)}`);
                const data = await res.json();
                if (data.dirs) {
                    // Filter matches
                    const currentStub = value.endsWith('/') ? '' : value.split('/').pop() || '';
                    const matches = data.dirs
                        .filter((d: string) => d.toLowerCase().startsWith(currentStub.toLowerCase()))
                        .map((d: string) => {
                             const prefix = lookupPath.endsWith('/') ? lookupPath : lookupPath + '/';
                             return prefix + d;
                        });
                    
                    setSuggestions(matches);
                    setIsOpen(matches.length > 0);
                }
            } catch (e) {
                // Squelch errors
            }

        }, 300);

        return () => clearTimeout(timeoutId);
    }, [value]);

    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (wrapperRef.current && !wrapperRef.current.contains(event.target as Node)) {
                setIsOpen(false);
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    const handleSelect = (path: string) => {
        // Automatically append slash to indicate directory drill-down
        const newPath = path.endsWith('/') ? path : path + '/';
        onChange(newPath);
        // Keep focus on input so users can continue typing or clicking subfolders
        if (wrapperRef.current) {
            const input = wrapperRef.current.querySelector('input');
            if(input) input.focus();
        }
        // Ensure dropdown stays open to show new suggestions from the effect hook
        setIsOpen(true); 
    };

    return (
        <div className="relative flex-1" ref={wrapperRef}>
            <input 
                value={value} 
                onChange={e => { onChange(e.target.value); setIsOpen(true); }} 
                placeholder="/media/photos" 
                className="w-full px-3 py-2 text-sm border rounded-lg focus:ring-2 focus:ring-primary-500 outline-none bg-white dark:bg-gray-700 text-gray-900 dark:text-white border-gray-200 dark:border-gray-600 placeholder-gray-400 dark:placeholder-gray-500" 
            />
            {isOpen && suggestions.length > 0 && (
                <div className="absolute top-full left-0 right-0 mt-1 bg-white dark:bg-gray-800 border border-gray-100 dark:border-gray-700 rounded-lg shadow-lg z-50 max-h-48 overflow-y-auto">
                    {suggestions.map((path) => (
                        <button 
                            key={path}
                            type="button"
                            onClick={() => handleSelect(path)}
                            className="w-full text-left px-3 py-2 text-sm hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-200 truncate flex items-center gap-2"
                        >
                            <Icons.Folder size={14} className="text-primary-500" />
                            {path}
                        </button>
                    ))}
                </div>
            )}
        </div>
    );
};
