"use client";
//import node modules libraries
import { Provider } from "react-redux";

//import redux store
import store from "store/store";

const ClientWrapper = ({ children }: { children: React.ReactNode }) => {
  return <Provider store={store}>{children}</Provider>;
};

export default ClientWrapper;
