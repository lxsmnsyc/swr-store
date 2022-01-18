import React, {
  FC,
} from 'react';
import {
  StoreAdapterRoot,
} from 'react-store-adapter';

const SWRStoreRoot: FC = ({ children }) => (
  <StoreAdapterRoot>
    {children}
  </StoreAdapterRoot>
);

if (process.env.NODE_ENV !== 'production') {
  SWRStoreRoot.displayName = 'SWRStoreRoot';
}

export default SWRStoreRoot;
