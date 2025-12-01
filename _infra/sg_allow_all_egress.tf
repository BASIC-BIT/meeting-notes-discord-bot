resource "aws_security_group_rule" "ecs_allow_all_egress" {
  type              = "egress"
  from_port         = 0
  to_port           = 0
  protocol          = "-1"
  security_group_id = aws_security_group.ecs_service_sg.id
  cidr_blocks       = ["0.0.0.0/0"]
  description       = "Allow all egress (temporary)"
}
