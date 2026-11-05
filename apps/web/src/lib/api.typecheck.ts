// 类型探针：带路径参数的接口必须要求 params。
import { call } from './api';
export const probe = () => [
  call('mediaDetail', { params: { id: 'm1' } }),
  // @ts-expect-error 缺少 params
  call('mediaDetail', {}),
  call('updateLibrary', { params: { id: 'l1' }, body: { name: 'x' } }),
];
