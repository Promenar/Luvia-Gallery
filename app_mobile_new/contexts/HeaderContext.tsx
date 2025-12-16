import React, { createContext, useContext, useState, useCallback } from 'react';

interface HeaderState {
    title: string;
    breadcrumb: string;
    showBack: boolean;
    onBack?: () => void;
    leftIcon?: 'menu' | 'back' | 'arrow-left' | string;
    onLeftPress?: () => void;
}

interface HeaderContextType extends HeaderState {
    setHeader: (config: Partial<HeaderState>) => void;
    resetHeader: () => void;
}

const defaultState: HeaderState = {
    title: 'Solid Explorer',
    breadcrumb: 'Internal Storage',
    showBack: false,
    leftIcon: 'menu' // Default
};

const HeaderContext = createContext<HeaderContextType>({
    ...defaultState,
    setHeader: () => { },
    resetHeader: () => { },
});

export const useHeader = () => useContext(HeaderContext);

export const HeaderProvider = ({ children }: { children: React.ReactNode }) => {
    const [state, setState] = useState<HeaderState>(defaultState);

    const setHeader = useCallback((config: Partial<HeaderState>) => {
        setState(prev => ({ ...prev, ...config }));
    }, []);

    const resetHeader = useCallback(() => {
        setState(defaultState);
    }, []);

    return (
        <HeaderContext.Provider value={{ ...state, setHeader, resetHeader }}>
            {children}
        </HeaderContext.Provider>
    );
};
