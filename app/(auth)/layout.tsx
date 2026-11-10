import { Container } from "react-bootstrap";
import Flex from "components/common/Flex";

const AuthLayout = ({ children }: { children: React.ReactNode }) => (
  <Flex tag="main" direction="column" justifyContent="center" className="vh-100">
    <section>
      <Container>{children}</Container>
    </section>
    <div className="custom-container text-center text-secondary small">Arshith Group Finance ERP · ArshithFresh · ArshithInfotech · Codelekho</div>
  </Flex>
);
export default AuthLayout;
