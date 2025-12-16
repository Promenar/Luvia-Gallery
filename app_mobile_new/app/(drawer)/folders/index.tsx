import React from 'react';
import FolderBrowser from '../../../components/FolderBrowser';

export default function FoldersIndex() {
    return <FolderBrowser isRoot={true} initialPath="root" />;
}
