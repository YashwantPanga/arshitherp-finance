"use client";
import { ReactNode } from "react";
import { Card, CardBody, Col, Row } from "react-bootstrap";
import { Brand } from "layouts/Sidebar";

export default function AuthShell({ title, subtitle, children }: { title: string; subtitle?: ReactNode; children: ReactNode }) {
  return (
    <>
      <Row className="mb-6">
        <Col xl={{ span: 4, offset: 4 }} md={12}>
          <div className="text-center">
            <div className="d-flex justify-content-center mb-6 fs-2"><Brand /></div>
            <h1 className="mb-1">{title}</h1>
            {subtitle && <p className="mb-0 text-secondary">{subtitle}</p>}
          </div>
        </Col>
      </Row>
      <Row className="justify-content-center">
        <Col xl={4} lg={5} md={8}>
          <Card className="card-lg mb-6"><CardBody className="p-6">{children}</CardBody></Card>
        </Col>
      </Row>
    </>
  );
}
