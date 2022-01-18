/** @jsx h */
import {
  h,
  FunctionComponent,
} from 'preact';
import {
  StoreAdapterRoot,
} from 'preact-store-adapter';

const SWRStoreRoot: FunctionComponent = ({ children }) => (
  <StoreAdapterRoot>
    {children}
  </StoreAdapterRoot>
);

if (process.env.NODE_ENV !== 'production') {
  SWRStoreRoot.displayName = 'SWRStoreRoot';
}

export default SWRStoreRoot;
