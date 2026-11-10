"use client";
// import node module libraries
import { Container, Row, Col, Breadcrumb } from "react-bootstrap";

// import required hooks
import { usePathname } from "next/navigation";
import { useRouter } from "next/navigation";

// import helper utility file
import { capitalizedWord } from "helper/utils";

const DasherBreadcrumb = () => {
  const path = usePathname();
  const router = useRouter();
  const pathSegments = path.split("/").filter((segment) => segment !== "");

  return (
    <div className="mt-4">
      <Container>
        <Row>
          <Col>
            <Breadcrumb className="mb-0">
              <Breadcrumb.Item onClick={() => router.push("/")}>
                Home
              </Breadcrumb.Item>
              {pathSegments.map((segment, index) =>
                index === pathSegments.length - 1 ? (
                  <Breadcrumb.Item
                    as="li"
                    active
                    key={segment}
                    className="text-capitalize"
                  >
                    {capitalizedWord(segment)}
                  </Breadcrumb.Item>
                ) : (
                  <Breadcrumb.Item as="li" key={segment}>
                    <span
                      onClick={() =>
                        router.push(
                          `/${pathSegments.slice(0, index + 1).join("/")}`
                        )
                      }
                    >
                      {capitalizedWord(segment)}
                    </span>
                  </Breadcrumb.Item>
                )
              )}
            </Breadcrumb>
          </Col>
        </Row>
      </Container>
    </div>
  );
};

export default DasherBreadcrumb;
